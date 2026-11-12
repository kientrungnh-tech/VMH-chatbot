import express from "express";
import { readFileSync } from "node:fs";

const app = express();
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
const PAGE_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
// Tuỳ chọn: URL nhận thông báo cho nhân viên (Google Chat, Slack, Zapier/n8n webhook...)
const STAFF_NOTIFY_URL = process.env.STAFF_NOTIFY_URL;
// Số giờ bot im lặng với một khách sau khi nhân viên trả lời tay hoặc sau khi chuyển nhân viên
const HUMAN_PAUSE_HOURS = Number(process.env.HUMAN_PAUSE_HOURS || 12);

const HOTLINE = "0257 7309 168";
const EMERGENCY = "0905 388 115";
const BOT_METADATA = "vmh-bot";

// Lời dẫn hệ thống nằm trong prompt.md để team sửa nội dung mà không cần đụng vào code
const SYSTEM_PROMPT = readFileSync(new URL("./prompt.md", import.meta.url), "utf8");

const TAG_RE = /\[(CAP_CUU|CHUYEN_NHAN_VIEN|LEAD:[A-Z_]+)\]/g;

const conversations = new Map(); // senderId -> [{role, content}]
const pausedUntil = new Map(); // senderId -> timestamp (ms)

app.get("/", (_req, res) => res.send("VMH chatbot OK"));

app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
    res.send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  const body = req.body;
  if (body.object !== "page") return;

  for (const entry of body.entry || []) {
    for (const event of entry.messaging || []) {
      try {
        await handleEvent(event);
      } catch (err) {
        console.error("Lỗi xử lý sự kiện:", err);
      }
    }
  }
});

async function handleEvent(event) {
  const message = event.message;
  if (!message) return;

  // Tin do fanpage gửi đi (echo). Nếu không phải do bot gửi => nhân viên đang trả lời tay => bot tạm im lặng.
  if (message.is_echo) {
    if (message.metadata !== BOT_METADATA) {
      const customerId = event.recipient.id;
      pause(customerId, "nhân viên trả lời trực tiếp");
      if (message.text) remember(customerId, "assistant", message.text);
    }
    return;
  }

  const senderId = event.sender.id;

  // Khách gửi ảnh, sticker, file... không kèm chữ: để nhân viên xem
  if (!message.text) {
    if (message.attachments?.length) {
      await notifyStaff(senderId, "CHUYEN_NHAN_VIEN", "Khách gửi ảnh/tệp, cần nhân viên xem");
    }
    return;
  }

  const userText = message.text;
  const history = remember(senderId, "user", userText);

  if (isPaused(senderId)) {
    console.log(JSON.stringify({ type: "skip_paused", senderId }));
    return;
  }

  let raw;
  try {
    raw = await getClaudeResponse(history);
  } catch (err) {
    console.error("Lỗi Claude:", err.message);
    await sendMessage(
      senderId,
      `Dạ em xin lỗi, hệ thống đang bận. Anh/chị vui lòng gọi ${HOTLINE} ạ. Trường hợp cấp cứu xin gọi ngay ${EMERGENCY} ạ.`
    );
    return;
  }

  const tags = [...raw.matchAll(TAG_RE)].map((m) => m[1]);
  const reply = raw.replace(TAG_RE, "").replace(/\n{3,}/g, "\n\n").trim();

  remember(senderId, "assistant", reply);
  await sendMessage(senderId, reply);

  for (const tag of new Set(tags)) {
    await notifyStaff(senderId, tag, userText);
    if (tag === "CAP_CUU" || tag === "CHUYEN_NHAN_VIEN") {
      pause(senderId, tag);
    }
  }
}

function remember(senderId, role, content) {
  if (!conversations.has(senderId)) conversations.set(senderId, []);
  const history = conversations.get(senderId);
  const last = history[history.length - 1];
  // Claude yêu cầu xen kẽ user/assistant: gộp các tin liên tiếp cùng vai
  if (last && last.role === role) {
    last.content += "\n" + content;
  } else {
    history.push({ role, content });
  }
  while (history.length > 20) history.shift();
  while (history.length && history[0].role !== "user") history.shift();
  return history;
}

function pause(senderId, reason) {
  pausedUntil.set(senderId, Date.now() + HUMAN_PAUSE_HOURS * 3600 * 1000);
  console.log(JSON.stringify({ type: "pause", senderId, reason, hours: HUMAN_PAUSE_HOURS }));
}

function isPaused(senderId) {
  const until = pausedUntil.get(senderId);
  if (!until) return false;
  if (Date.now() > until) {
    pausedUntil.delete(senderId);
    return false;
  }
  return true;
}

async function getClaudeResponse(history) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 600,
      temperature: 0.3,
      // cache_control giúp giảm chi phí vì lời dẫn hệ thống dài và giống nhau mọi lượt
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: history,
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(`Claude error: ${data.error.type} ${data.error.message}`);
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("Claude trả về rỗng");
  return text;
}

async function notifyStaff(senderId, tag, text) {
  const record = { type: "staff_alert", tag, senderId, text, at: new Date().toISOString() };
  console.log(JSON.stringify(record)); // luôn ghi log để đếm lead trên Railway
  if (!STAFF_NOTIFY_URL) return;
  const label = tag === "CAP_CUU" ? "🚨 CẤP CỨU" : tag === "CHUYEN_NHAN_VIEN" ? "Cần nhân viên" : `Lead ${tag.slice(5)}`;
  try {
    await fetch(STAFF_NOTIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `[VMH Messenger] ${label} – khách ${senderId}: ${text}`, ...record }),
    });
  } catch (err) {
    console.error("Lỗi gửi thông báo nhân viên:", err.message);
  }
}

async function sendMessage(recipientId, text) {
  // Messenger giới hạn 2000 ký tự mỗi tin
  const chunks = [];
  for (let rest = text; rest.length; ) {
    let cut = rest.length <= 1900 ? rest.length : rest.lastIndexOf("\n", 1900);
    if (cut <= 0) cut = 1900;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  for (const chunk of chunks) {
    const res = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        messaging_type: "RESPONSE",
        message: { text: chunk, metadata: BOT_METADATA },
      }),
    });
    const data = await res.json();
    if (data.error) console.error("Messenger error:", data.error);
  }
}

app.listen(process.env.PORT || 3000, () => console.log("✅ Server VMH chạy rồi! Model:", ANTHROPIC_MODEL));
