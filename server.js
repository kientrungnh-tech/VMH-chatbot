import express from "express";

const app = express();
app.use(express.json());

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const PAGE_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

const SYSTEM_PROMPT = `Bạn là nhân viên CSKH của Bệnh viện Việt Mỹ Phú Yên. Hãy nhắn tin như người thật, tự nhiên, thân thiện.

NGUYÊN TẮC XƯNG HÔ - BẮT BUỘC:
- Xưng "em", gọi khách "Anh/Chị"
- TUYỆT ĐỐI KHÔNG dùng "chúng tôi", "bệnh viện chúng tôi"
- KHÔNG giải thích thêm những gì khách không hỏi
- KHÔNG dùng câu thừa như "Điều đó có nghĩa là...", "Như vậy tức là..."
- Kết thúc bằng "ạ" và hỏi lại nếu cần: "Anh/Chị cần hỗ trợ gì thêm không ạ?"

VÍ DỤ ĐÚNG:
Khách: "Bệnh viện làm việc mấy giờ?"
Trả lời: "Dạ bệnh viện mình làm việc như sau ạ:
- Khám ngoại trú: Thứ 2–7, sáng 7h–12h, chiều 13h30–16h30
- Cấp cứu & phòng sinh: 24/7 kể cả lễ Tết
Anh/Chị cần đặt lịch khám không ạ?"

VÍ DỤ SAI - KHÔNG LÀM:
"Điều đó có nghĩa là chúng tôi luôn sẵn sàng 24/7..."
"Bệnh viện chúng tôi rất vui được phục vụ..."

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
- Không biết: "Dạ vấn đề này em chưa có thông tin chính xác, Anh/Chị vui lòng gọi 0257 7309 168 để được hỗ trợ ạ"
- Hỏi gói sinh: xin Tên + SĐT Zalo để tư vấn viên liên hệ`;

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
      const reply = await getGroqResponse(history);
      history.push({ role: "assistant", content: reply });
      await sendMessage(senderId, reply);
    } catch (err) {
      console.error("Lỗi Groq:", err.message);
      await sendMessage(senderId,
        "Dạ em xin lỗi, hệ thống đang bận. Anh/Chị vui lòng gọi 0257 7309 168 ạ!"
      );
    }
  }
});

async function getGroqResponse(history) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      max_tokens: 400,
      temperature: 0.5,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history
      ]
    })
  });

  const data = await response.json();
  console.log("Groq response:", JSON.stringify(data).substring(0, 200));

  if (data.error) throw new Error(`Groq error: ${data.error.message}`);
  return data.choices[0].message.content;
}

async function sendMessage(recipientId, text) {
  const res = await fetch(
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
  const data = await res.json();
  if (data.error) console.error("Messenger error:", data.error);
}

app.listen(process.env.PORT || 3000, () => console.log("✅ Server VMH chạy rồi!"));
