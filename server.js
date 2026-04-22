import express from "express";
import Anthropic from "@anthropic-ai/sdk";

const app = express();
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const PAGE_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

const SYSTEM_PROMPT = `Bạn là trợ lý chăm sóc khách hàng của Bệnh viện Việt Mỹ Phú Yên.
Trả lời thân thiện, ngắn gọn bằng tiếng Việt, xưng "em" với khách.

THÔNG TIN BỆNH VIỆN:
- Địa chỉ: 168 Trần Phú, phường Tuy Hòa, tỉnh Đắk Lắk
- Hotline: 0257 7309 168
- Website: https://vietmyhospital.com/

GIỜ LÀM VIỆC:
- Ngoại trú BHYT: Thứ 2–7, Sáng 7h–12h, Chiều 13h30–16h30
- Cấp cứu / Phòng sinh / Nội trú: 24/7 kể cả lễ Tết

GIÁ DỊCH VỤ:
- Sinh thường (3 ngày): 7tr–8,8tr tùy phòng, BHYT hỗ trợ ~1tr
- Sinh mổ lần 1 (5 ngày): 13,3tr–16,5tr
- Sinh mổ lần 2 (5 ngày): 15,4tr–18,5tr
- Nội soi đại tràng: 1.650.000–1.750.000đ
- MRI: 2.200.000đ/vùng
- Cắt bao quy đầu (Stapler): ~7.000.000đ (đã trừ BHYT)
- Khám tổng quát Nam/Nữ: từ 367.000đ
- Khám lái xe: 260.000đ
- Hồ sơ xin việc: 150.000đ (chưa XN) / 617.000đ (có XN)

DỊCH VỤ CÓ: Nhi khoa, tiêm chủng, cấy que tránh thai, nội soi, MRI
KHÔNG CÓ: Da liễu, soi da

QUY TẮC:
- KHÔNG chẩn đoán bệnh, KHÔNG kê đơn thuốc
- Câu hỏi ngoài khả năng: mời gọi hotline 0257 7309 168
- Hỏi gói sinh: đề nghị để lại Tên + SĐT Zalo`;

const conversations = new Map();

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

  for (const entry of body.entry) {
    const event = entry.messaging?.[0];
    if (!event?.message?.text) continue;

    const senderId = event.sender.id;
    const userText = event.message.text;

    if (!conversations.has(senderId)) conversations.set(senderId, []);
    const history = conversations.get(senderId);
    history.push({ role: "user", content: userText });
    if (history.length > 20) history.splice(0, 2);

    try {
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: history,
      });
      const reply = response.content[0].text;
      history.push({ role: "assistant", content: reply });
      await sendMessage(senderId, reply);
    } catch (err) {
      console.error("Lỗi:", err);
      await sendMessage(senderId,
        "Dạ em xin lỗi, hệ thống đang bận. Anh/Chị vui lòng gọi 0257 7309 168 ạ!"
      );
    }
  }
});

async function sendMessage(recipientId, text) {
  await fetch(
    `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
      }),
    }
  );
}

app.listen(process.env.PORT || 3000, () => console.log("✅ Server đang chạy!"));