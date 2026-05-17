# Luồng Hoạt Động Chatbot GoPark

Tài liệu này mô tả cách chatbot xử lý một tin nhắn từ lúc người dùng gửi câu hỏi đến lúc trả response cho FE.

## 1. USER Chatbot

Endpoint: `POST /api/v1/chatbot/chat`

```text
User gửi câu hỏi
→ OptionalAuthGuard đọc token nếu có
→ ChatbotController.parseMessages()
→ ChatbotService.processMessage()
```

### Bước xử lý trong `ChatbotService.processMessage`

1. Lấy tin nhắn cuối cùng có role `user`.
2. Chạy `classifyIntent()` để phân loại ý định.
3. Chạy `isClearlyOffTopic()`:
   - Nếu câu hỏi không liên quan GoPark, trả lời xin lỗi mềm.
   - Không gọi LLM, không query data.
4. Kiểm tra câu hỏi data public như top bãi, bãi còn chỗ, bãi giá cao/rẻ:
   - Hàm: `answerPublicParkingDataQuestion()`.
   - Dùng DB/TypeORM, trả bảng markdown.
5. Kiểm tra câu tổng quan tài khoản:
   - Hàm: `getUserAccountOverview()`.
   - Query ví, xe, booking gần đây.
6. Nếu intent cần data cố định:
   - `CHECK_WALLET` → `getWalletBalance()`.
   - `CHECK_VEHICLES` → `getUserVehicles()`.
   - `CHECK_BOOKING` → `getUserBookings()`.
   - `FIND_NEARBY/FIND_BEST` → `searchParking()`.
7. Nếu intent đặt bãi:
   - Hàm: `handleSmartBooking()`.
   - Dùng `ChatbotStateService` để nhớ bãi, giờ, xe, slot, thanh toán.
   - Kiểm tra giờ mở cửa bằng `validateParkingLotOperatingTime()`.
   - Lấy slot trống bằng `getAvailableSlotsForBooking()`.
   - Khi đủ dữ liệu, trả `action: redirect`.
8. Nếu là câu tự do hoặc hướng dẫn:
   - Hàm: `runLlmToolRagPipeline()`.
   - Lấy context từ `ChatbotKnowledgeService`.
   - Nếu câu cần data runtime thì bật function calling.
   - Nếu provider lỗi tool call, retry không tool.

## 2. RAG Nhẹ

RAG nằm ở:

- `chatbot-guide.service.ts`: load `README.md` và toàn bộ `knowledgebase/*.md`.
- `chatbot-knowledge.service.ts`: chia markdown thành chunk, vector hóa bằng token đơn giản, tìm chunk liên quan.

Luồng:

```text
User question
→ buildContext(question)
→ chọn 3-4 chunk liên quan
→ nhét vào system prompt
→ LLM dùng làm hướng dẫn/policy/style
```

RAG không được dùng để bịa số liệu runtime. Số liệu phải lấy từ DB hoặc tool.

## 3. Function Calling

Tool được định nghĩa trong `getToolsDefinition()`:

| Tool | Mục đích |
|---|---|
| `search_parking` | Tìm bãi theo gần nhất, rẻ nhất, rating, khu vực, tên |
| `get_user_bookings` | Lấy lịch sử đặt của user |
| `get_wallet_balance` | Lấy số dư ví |
| `get_user_vehicles` | Lấy xe đã đăng ký |
| `book_parking` | Tạo redirect đặt bãi khi đủ dữ liệu |
| `cancel_booking` | Hủy booking theo ID |

Luồng tool:

```text
LLM quyết định gọi tool
→ executeTool()
→ query DB hoặc gọi helper service
→ compactToolResult()
→ gửi tool result lại cho LLM
→ LLM tổng hợp câu trả lời cuối
```

## 4. OWNER Chatbot

Endpoint: `POST /api/v1/chatbot/owner/chat`

Luồng chính:

```text
Owner gửi câu hỏi
→ AuthGuard + RolesGuard OWNER
→ OwnerChatbotService.processOwnerMessage()
→ classifyOwnerIntent()
→ query data owner theo userId
→ trả markdown/table/chartData nếu có
```

Intent quan trọng:

- `OWNER_DASHBOARD`: dashboard vận hành hôm nay.
- `REVENUE_MONTH/WEEK/QUARTER`: doanh thu theo kỳ.
- `REVENUE_DETAIL`: phân tích tỷ trọng và trung bình/booking.
- `COMPARE_MONTH/WEEK`: so sánh kỳ.
- `TOP_PARKING`: top bãi tốt/doanh thu cao.
- `LOW_PERFORMANCE`: bãi hoạt động kém.
- `SUGGEST_IMPROVE`: gợi ý tăng doanh thu.
- `PARKING_INFO`: xem chi tiết bãi thuộc owner.

## 5. ADMIN Chatbot

Endpoint: `POST /api/v1/chatbot/admin/chat`

Luồng chính:

```text
Admin gửi câu hỏi
→ AuthGuard + RolesGuard ADMIN
→ AdminChatbotService.processAdminMessage()
→ match intent bằng keyword
→ query dữ liệu toàn hệ thống
→ trả markdown/table ngắn
```

Chức năng chính:

- `tổng quan hệ thống`: user, doanh thu hôm nay, trạng thái bãi, booking hôm nay.
- `cảnh báo hệ thống`: yêu cầu chờ duyệt, hóa đơn chưa PAID, thanh toán lỗi, bãi gần hết chỗ.
- `tìm user ...`: tìm theo email/tên.
- `tìm bãi ...`: tìm theo tên/địa chỉ.
- `top 5 bãi ...`: ranking theo chỗ trống, giá, đánh giá.
- `yêu cầu chờ duyệt`: danh sách request pending.
- `hóa đơn chưa thanh toán`: invoice chưa PAID.

## 6. Response Cho FE

Các dạng response phổ biến:

```ts
{ text: string }
{ text: string, action: 'list_parking', data: { lots: [...] } }
{ text: string, action: 'collect_booking', data: { missing, suggestions, pendingBooking } }
{ text: string, action: 'redirect', redirectUrl: string }
```

FE render markdown table bằng component shared `ChatMessageContent`.

## 7. Cách Thêm Chức Năng Mới

1. Xác định role: USER, OWNER hay ADMIN.
2. Nếu là USER:
   - Thêm keyword trong `Chatbot.intent.ts` nếu cần intent mới.
   - Thêm handler trong `ChatbotService.processMessage()`.
   - Nếu cần tool LLM, thêm schema ở `getToolsDefinition()` và handler ở `executeTool()`.
3. Nếu là OWNER:
   - Thêm intent trong `classifyOwnerIntent()`.
   - Thêm hàm query/phân tích trong `OwnerChatbotService`.
4. Nếu là ADMIN:
   - Thêm keyword route trong `processAdminMessage()`.
   - Thêm hàm query trong `AdminChatbotService`.
5. Thêm knowledgebase nếu LLM cần hiểu policy/style.
6. Thêm test spec và chạy build.
