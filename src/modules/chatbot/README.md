# GoPark Chatbot – Tài liệu kỹ thuật

## Tổng quan kiến trúc

```
src/modules/chatbot/
├── chatbot.controller.ts        # Endpoints USER chatbot
├── chatbot.service.ts           # Logic xử lý USER chatbot
├── chatbot-state.service.ts     # Quản lý session/context
├── Chatbot.intent.ts            # Intent classification + keywords
├── owner-chatbot.controller.ts  # Endpoints OWNER chatbot
├── owner-chatbot.service.ts     # Logic xử lý OWNER chatbot
├── guards/
│   ├── auth.guard.ts            # Bắt buộc đăng nhập
│   └── optional-auth.guard.ts  # Không bắt buộc đăng nhập
└── README.md
```

---

## API Endpoints

| Method | Endpoint | Guard | Mô tả |
|--------|----------|-------|-------|
| GET | `/api/v1/chatbot/status` | Public | Kiểm tra kết nối Groq AI |
| POST | `/api/v1/chatbot/chat` | Optional | Chat USER (có/không đăng nhập) |
| POST | `/api/v1/chatbot/book` | Auth | Đặt bãi từ form |
| POST | `/api/v1/chatbot/stream` | Optional | SSE stream |
| GET | `/api/v1/chatbot/suggestions` | Public | Gợi ý câu hỏi nhanh |
| POST | `/api/v1/chatbot/owner/chat` | Auth + OWNER role | Chat OWNER |

### Request / Response

```json
// Request
POST /api/v1/chatbot/chat
Authorization: Bearer <token>
{
  "messages": [{ "role": "user", "content": "tìm bãi gần tôi" }],
  "context": { "userLat": 16.047, "userLng": 108.206 }  // optional GPS
}

// Response – list_parking
{
  "statusCode": 201,
  "data": {
    "text": "📍 Tìm thấy 5 bãi gần bạn nhất...",
    "action": "list_parking",
    "data": {
      "lots": [{ "id": 1, "name": "...", "distance_km": 0.8, ... }],
      "criteria": "nearest"
    }
  }
}

// Response – text thường
{
  "statusCode": 201,
  "data": { "text": "💰 Số dư ví GoPark của bạn: 2,174,302đ." }
}
```

---

## Intent Classification

### USER Intents

| Intent | Keywords mẫu | Xử lý |
|--------|-------------|-------|
| `FIND_NEARBY` | "tìm bãi gần tôi", "bãi gần đây", "tim bai gan toi" | Query DB → sort theo distance/available_slots |
| `FIND_BEST` | "bãi phù hợp nhất", "gợi ý bãi", "bai phu hop" | Query DB → composite score |
| `CHECK_WALLET` | "số dư ví", "so du vi" | Query `wallets` table |
| `CHECK_BOOKING` | "lịch sử đặt", "lich su dat cua toi" | Query `bookings` table |
| `CHECK_VEHICLES` | "xe của tôi", "xe cua toi" | Query `vehicles` table |
| `BOOK_PARKING` | "đặt bãi", "dat bai" | Hỏi thông tin → redirect |
| `PAYMENT_GUIDE` | "hướng dẫn thanh toán" | Groq AI |
| `FREE_FORM` | Câu hỏi tự do | Groq LLM |

### OWNER Intents

| Intent | Keywords mẫu |
|--------|-------------|
| `REVENUE_WEEK` | "doanh thu tuần này" |
| `REVENUE_MONTH` | "doanh thu tháng này" |
| `COMPARE_MONTH` | "so sánh tháng này vs tháng trước" |
| `TOP_PARKING` | "bãi doanh thu cao nhất" |
| `SUGGEST_IMPROVE` | "gợi ý tăng doanh thu" |
| `LOW_PERFORMANCE` | "bãi hoạt động kém" |

---

## Thuật toán tìm bãi

### FIND_NEARBY (`criteria: 'nearest'`)
- Nếu có GPS (`userLat`, `userLng`): tính khoảng cách Haversine, sort tăng dần
- Không có GPS: sort theo `available_slots` giảm dần
- Trả về **5 bãi**, hiển thị cột `distance_km` nếu có GPS

### FIND_BEST (`criteria: 'best_rating'`)
- Điểm tổng hợp = `(rating/5)*40 + (slots/maxSlots)*30 + (1 - price/maxPrice)*30`
- Trọng số: Đánh giá 40% · Chỗ trống 30% · Giá rẻ 30%
- Chỉ lấy bãi còn chỗ (`available_slots > 0`)
- Trả về **1 bãi tốt nhất** (không có bảng phụ)

### FIND_CHEAPEST (`criteria: 'price_cheapest'`)
- Sort theo `hourly_rate` tăng dần
- Ưu tiên bãi còn chỗ
- Trả về **5 bãi**, hiển thị bảng đầy đủ

---

## Database Schema liên quan

```sql
-- Bãi đỗ
parking_lots (id, name, address, lat, lng, total_slots, available_slots, status)

-- Cấu trúc bãi
parking_floors (id, parking_lot_id)
parking_zones  (id, parking_floor_id, zone_name, total_slots)
parking_slots  (id, parking_zone_id, code, status)

-- Giá
pricing_rules (id, parking_zone_id, price_per_hour)

-- Booking
bookings (id, user_id, slot_id, vehicle_id, start_time, end_time, status, created_at)

-- Ví
wallets (id, user_id, balance)

-- Xe
vehicles (id, user_id, plate_number, type)
```

---

## Cấu hình môi trường

```env
# .env (Backend)
GORQ_API_KEY=gsk_xxxxxxxxxxxx          # Groq API key (bắt buộc)
GOOGLE_API_KEY=AIzaSy_xxxx             # Gemini (optional)
GOOGLE_GEMINI_MODEL=models/gemini-1.0  # optional

JWT_ACCESS_SECRET=gopark-secret-key-123
DATABASE_URL=postgresql://...
```

---

## Triển khai (Deployment)

### Local Development

```bash
# 1. Cài dependencies
cd GoPark_BE_2026
npm install

# 2. Tạo file .env (copy từ .env.example)
cp .env.example .env
# Điền GORQ_API_KEY vào .env

# 3. Chạy dev server
npm run start:dev
# Server chạy tại http://localhost:8000

# 4. Test chatbot status
curl http://localhost:8000/api/v1/chatbot/status
# Kết quả mong đợi: { "data": { "running": true, "models": { "groq": { "ok": true } } } }
```

### Test nhanh bằng curl

```bash
# Login lấy token
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"nguyendung17032005@gmail.com","password":"nguyendung"}' \
  | python -c "import sys,json; print(json.load(sys.stdin)['data']['accessToken'])")

# Test tìm bãi gần tôi
curl -X POST http://localhost:8000/api/v1/chatbot/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"messages":[{"role":"user","content":"tìm bãi gần tôi"}],"context":{"userLat":16.047,"userLng":108.206}}'

# Test số dư ví
curl -X POST http://localhost:8000/api/v1/chatbot/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"messages":[{"role":"user","content":"số dư ví"}]}'
```

### Production

```bash
# Build
npm run build

# Chạy production
npm run start:prod

# Hoặc với PM2
pm2 start dist/main.js --name gopark-be
```

---

## Kết quả test (12/05/2026)

| # | Câu hỏi | Intent | Status | Ghi chú |
|---|---------|--------|--------|---------|
| 1 | "tìm bãi gần tôi" | FIND_NEARBY | ✅ PASS | action=list_parking, 5 lots |
| 2 | "bãi rẻ nhất" | FIND_BEST | ✅ PASS | action=list_parking |
| 3 | "số dư ví" | CHECK_WALLET | ✅ PASS | Trả đúng số dư thực |
| 4 | "xe của tôi" | CHECK_VEHICLES | ✅ PASS | Trả danh sách xe |
| 5 | "lịch sử đặt" | CHECK_BOOKING | ✅ PASS | SQL query đã fix |
| 6 | "hướng dẫn thanh toán" | FREE_FORM | ✅ PASS | Groq trả lời |
| 7 | "doanh thu tuần này" (OWNER) | FREE_FORM | ✅ PASS | Groq phân tích |

---

## Lưu ý quan trọng

- `GORQ_API_KEY` trong `.env` **không được có dấu cách** trước `=`
- Nest watch mode **không reload** khi `.env` thay đổi → cần restart server
- `OptionalAuthGuard` cho phép dùng chatbot không cần đăng nhập, nhưng các intent cần userId (ví, xe, booking) sẽ trả về lỗi nếu chưa login
- GPS (`userLat`, `userLng`) được FE gửi kèm khi user hỏi "gần tôi" → cần cấp quyền location trên trình duyệt
