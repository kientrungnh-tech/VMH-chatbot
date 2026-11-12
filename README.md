# VMH chatbot (Messenger)

Chatbot Messenger cho Bệnh viện Việt Mỹ Phú Yên, chạy bằng Claude Haiku.

## File chính

- `prompt.md`: lời dẫn hệ thống, gồm phong cách, quy tắc an toàn và kho kiến thức (giá, giờ làm việc, BHYT...). **Muốn sửa giá hay nội dung trả lời thì chỉ sửa file này**, sau đó deploy lại.
- `server.js`: nhận tin từ Messenger, gọi Claude, gửi trả lời, báo nhân viên.

## Biến môi trường (Railway → Variables)

| Biến | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Có | API key Claude (console.anthropic.com) |
| `PAGE_ACCESS_TOKEN` | Có | Token fanpage (giữ như cũ) |
| `VERIFY_TOKEN` | Có | Token xác minh webhook (giữ như cũ) |
| `ANTHROPIC_MODEL` | Không | Mặc định `claude-haiku-5-5` |
| `STAFF_NOTIFY_URL` | Không | Webhook nhận cảnh báo cho nhân viên (Google Chat, Slack, n8n...) |
| `HUMAN_PAUSE_HOURS` | Không | Số giờ bot im lặng sau khi nhân viên trả lời tay hoặc sau khi chuyển nhân viên. Mặc định 12 |

`GROQ_API_KEY` không còn dùng, có thể xoá.

## Cài đặt trên Meta (bắt buộc để bot tự im khi nhân viên trả lời)

Trong Meta App → Messenger → Webhooks của fanpage, đăng ký thêm trường **`message_echoes`** (bên cạnh `messages`).
Khi nhân viên trả lời tay trong Business Suite, bot nhận được "echo" và tự dừng trả lời khách đó trong `HUMAN_PAUSE_HOURS` giờ.

## Bot làm gì với nhãn

Claude gắn nhãn ở cuối câu trả lời. Server cắt nhãn trước khi gửi cho khách, rồi:

- `[CAP_CUU]`, `[CHUYEN_NHAN_VIEN]`: báo nhân viên và tạm dừng bot với khách đó.
- `[LEAD:GOI_SINH]`, `[LEAD:KSK]`, `[LEAD:NOI_SOI]`, `[LEAD:KHAC]`: ghi log `staff_alert` để đếm lead theo dịch vụ (lọc log Railway theo `staff_alert`).

Khách gửi ảnh hoặc tệp không kèm chữ: bot không trả lời, chỉ báo nhân viên.

## Lưu ý

Lịch sử hội thoại lưu trong bộ nhớ, sẽ mất khi server khởi động lại.
