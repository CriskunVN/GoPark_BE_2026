# GoPark Chatbot - Hướng dẫn

## Cấu trúc

Chatbot được chia thành 2 loại theo role:

### 1. **User Chatbot** (Người dùng)
- **Folder**: `user/`
- **Chức năng**:
  - 🔍 Tìm kiếm bãi đỗ (gần nhất, giá rẻ, phù hợp nhất)
  - 📅 Đặt bãi đỗ xe
  - 📋 Xem lịch sử đặt chỗ
  - 💳 Kiểm tra số dư ví
  - 🚗 Xem danh sách xe đã đăng ký
  - ❓ Hướng dẫn thanh toán

### 2. **Owner Chatbot** (Chủ bãi)
- **Folder**: `owner/`
- **Controller**: `owner-chatbot.controller.ts`
- **Service**: `owner-chatbot.service.ts`
- **Endpoint**: `POST /api/v1/chatbot/owner/chat`
- **Chức năng**:
  - 📊 Phân tích doanh thu theo tuần/tháng/quý
  - 📈 So sánh doanh thu giữa các kỳ
  - 🏆 Xem top bãi doanh thu cao nhất
  - 💡 Gợi ý biện pháp tăng doanh thu
  - ⚠️ Phát hiện bãi hoạt động kém
  - 📋 Báo cáo tổng quan

## Backend

### Endpoints

#### User Chatbot (hiện tại)
- `POST /api/v1/chatbot/chat` - Chat thường (optional auth)
- `POST /api/v1/chatbot/book` - Đặt bãi (require auth)
- `GET /api/v1/chatbot/status` - Health check
- `GET /api/v1/chatbot/suggestions` - Gợi ý nhanh

#### Owner Chatbot (mới)
- `POST /api/v1/chatbot/owner/chat` - Chat phân tích doanh thu (require OWNER role)

### Guards
- `AuthGuard` - Yêu cầu đăng nhập
- `RolesGuard` - Kiểm tra role (OWNER)
- `OptionalAuthGuard` - Không bắt buộc đăng nhập

### Intent Classification (Owner)

```typescript
REVENUE_WEEK      // "doanh thu tuần này"
REVENUE_MONTH     // "doanh thu tháng này"
REVENUE_QUARTER   // "doanh thu quý này"
COMPARE_MONTH     // "so sánh tháng này vs tháng trước"
COMPARE_WEEK      // "so sánh tuần này vs tuần trước"
TOP_PARKING       // "bãi doanh thu cao nhất"
SUGGEST_IMPROVE   // "gợi ý tăng doanh thu"
LOW_PERFORMANCE   // "bãi hoạt động kém"
FREE_FORM         // Câu hỏi tự do → gọi Groq AI
```

## Frontend

### Cấu trúc Component

```
src/components/chatbot/
├── Chatbot.tsx              # Wrapper - kiểm tra role & render đúng chatbot
├── user/
│   └── UserChatbot.tsx      # UI cho USER
└── owner/
    └── OwnerChatbot.tsx     # UI cho OWNER
```

### Logic Wrapper (`Chatbot.tsx`)

```typescript
- Kiểm tra isAuthenticated → nếu chưa đăng nhập → không hiện chatbot
- Kiểm tra role:
  - USER  → render <UserChatbot />
  - OWNER → render <OwnerChatbot />
  - ADMIN → không hiện chatbot
```

### Styling

- **UserChatbot**: Màu xanh lá (green theme) - `.uc-*`
- **OwnerChatbot**: Màu vàng cam (amber theme) - `.ow-*`
- Mỗi chatbot có style riêng, không conflict

### Features

#### UserChatbot
- Hiển thị danh sách bãi đỗ dạng card + table
- Quick chips: tìm bãi, đặt bãi, xem ví, lịch sử
- Speech recognition (voice input)
- Redirect tự động khi đặt bãi

#### OwnerChatbot
- Hiển thị dữ liệu doanh thu dạng table
- Quick chips: phân tích tuần/tháng/quý, so sánh, gợi ý
- Highlight số liệu quan trọng
- Gợi ý cải thiện dựa trên dữ liệu

## Cách sử dụng

### 1. Đăng nhập
Chatbot chỉ hiện khi user đã đăng nhập (`isAuthenticated = true`)

### 2. Role-based Display
- **USER**: Thấy chatbot màu xanh với badge "👤 USER"
- **OWNER**: Thấy chatbot màu vàng với badge "🏢 OWNER"

### 3. Tương tác
- Gõ câu hỏi hoặc click quick chips
- Enter để gửi, Shift+Enter để xuống dòng
- Voice input (chỉ UserChatbot)

## Environment Variables

```env
GROQ_API_KEY=your_groq_api_key
JWT_ACCESS_SECRET=your_jwt_secret
```

## Database Queries

Owner chatbot query từ các bảng:
- `bookings` - Đơn đặt chỗ
- `parking_lots` - Bãi đỗ
- `parking_floors`, `parking_zones`, `parking_slots` - Cấu trúc bãi

Filters:
- `owner_id` - Chỉ lấy bãi của owner đang đăng nhập
- `status IN ('CONFIRMED', 'COMPLETED')` - Chỉ tính booking thành công
- Time ranges: 7 days, 30 days, 90 days

## Testing

### User Chatbot
```bash
curl -X POST http://localhost:8000/api/v1/chatbot/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <user_token>" \
  -d '{"messages": [{"role": "user", "content": "Tìm bãi gần tôi"}]}'
```

### Owner Chatbot
```bash
curl -X POST http://localhost:8000/api/v1/chatbot/owner/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <owner_token>" \
  -d '{"messages": [{"role": "user", "content": "Doanh thu tuần này"}]}'
```

## Notes

- Owner chatbot yêu cầu role OWNER, nếu không sẽ bị 403 Forbidden
- User chatbot có OptionalAuthGuard - có thể dùng không cần đăng nhập (nhưng UI chỉ hiện khi đã login)
- Cả 2 chatbot đều lưu lịch sử chat riêng trong localStorage
- Groq AI được dùng cho câu hỏi tự do (FREE_FORM intent)
