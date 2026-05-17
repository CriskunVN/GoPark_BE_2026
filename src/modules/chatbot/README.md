# GoPark Chatbot Module

Module chatbot gom toàn bộ luồng AI cho 3 vai trò: USER, OWNER và ADMIN. Mục tiêu là tách rõ controller, service xử lý theo role, session, RAG knowledgebase, function calling và test.

## Cấu Trúc Thư Mục

```text
src/modules/chatbot/
├── README.md                         # Tổng quan module và cấu trúc thư mục
├── docs/
│   └── chat-flow.md                  # Luồng hoạt động chi tiết của chatbot
├── knowledgebase/
│   ├── booking-flow.md               # Hướng dẫn luồng đặt bãi
│   ├── data-question-playbook.md     # Quy tắc câu hỏi cần dữ liệu
│   ├── off-topic-policy.md           # Chính sách từ chối câu hỏi ngoài phạm vi
│   ├── response-style.md             # Quy tắc phong cách trả lời
│   ├── role-admin-playbook.md        # Năng lực và cách trả lời cho ADMIN
│   ├── role-owner-playbook.md        # Năng lực và cách trả lời cho OWNER
│   └── role-user-playbook.md         # Năng lực và cách trả lời cho USER
├── entities/
│   └── chatbot-session.entity.ts     # Entity lưu hội thoại
├── guards/
│   ├── auth.guard.ts                 # Bắt buộc đăng nhập
│   └── optional-auth.guard.ts        # Cho phép public chat nhưng vẫn đọc user nếu có token
├── chatbot.controller.ts             # API USER chatbot
├── chatbot.service.ts                # Orchestrator USER: intent, query data, RAG, tool calling, LLM
├── Chatbot.intent.ts                 # Keyword classifier cho USER intent
├── chatbot-state.service.ts          # Session ngắn hạn cho flow đặt bãi nhiều bước
├── chatbot-guide.service.ts          # Load README + knowledgebase markdown
├── chatbot-knowledge.service.ts      # RAG nhẹ: chia chunk, vector từ khóa, tìm ngữ cảnh
├── owner-chatbot.controller.ts       # API OWNER chatbot
├── owner-chatbot.service.ts          # Query/phân tích dữ liệu owner
├── admin-chatbot.controller.ts       # API ADMIN chatbot
├── admin-chatbot.service.ts          # Query dữ liệu admin, cảnh báo, tìm kiếm
├── chatbot-layer4.spec.ts            # Test flow tích hợp nhiều role
├── chatbot-llm-pipeline.spec.ts      # Test pipeline RAG + function calling + LLM
├── owner-chatbot.service.spec.ts     # Test OWNER chatbot
└── admin-chatbot.service.spec.ts     # Test ADMIN chatbot
```

## Endpoint Chính

| Role | Endpoint | Guard | Mục đích |
|---|---|---|---|
| Public/User | `POST /api/v1/chatbot/chat` | OptionalAuthGuard | Chat người dùng, tìm bãi, đặt bãi, ví, xe |
| User | `POST /api/v1/chatbot/book` | AuthGuard | Tạo booking từ form/chatbot |
| Owner | `POST /api/v1/chatbot/owner/chat` | Auth + OWNER | Báo cáo doanh thu, dashboard, phân tích bãi |
| Admin | `POST /api/v1/chatbot/admin/chat` | Auth + ADMIN | Tổng quan hệ thống, cảnh báo, user, bãi, yêu cầu |
| Public | `GET /api/v1/chatbot/status` | Public | Kiểm tra trạng thái model |
| Public | `GET /api/v1/chatbot/suggestions` | Public | Gợi ý câu hỏi nhanh |

## Luồng Hoạt Động

Xem chi tiết tại [docs/chat-flow.md](./docs/chat-flow.md).

Tóm tắt:

```text
Người dùng gửi tin nhắn
→ Controller xác thực role/token
→ Service lấy câu user cuối
→ Guard off-topic
→ Classify intent
→ Nếu là intent data cố định: query DB trực tiếp
→ Nếu là đặt bãi: dùng state nhiều bước
→ Nếu là câu tự do: lấy RAG context + LLM + function calling
→ Chuẩn hóa response cho FE
```

## Nguyên Tắc Phát Triển

- Không bịa số liệu. Câu hỏi về doanh thu, booking, ví, xe, slot, user, invoice phải query data hoặc gọi function.
- Không show ID nội bộ nếu người dùng không cần thao tác bằng ID.
- Câu hỏi ngoài phạm vi GoPark phải từ chối mềm và gợi ý câu hỏi đúng role.
- Knowledgebase chỉ dùng cho hướng dẫn, style, policy, không dùng thay số liệu runtime.
- Với bảng dữ liệu, giữ bảng ngắn và dễ đọc để không tràn giao diện chat.

## Test Nhanh

```bash
cd GoPark_BE_2026
npm test -- chatbot-layer4.spec.ts chatbot-llm-pipeline.spec.ts admin-chatbot.service.spec.ts owner-chatbot.service.spec.ts --runInBand
npm run build
```
