# Data Question Playbook

## Quy tắc dùng data
- Câu hỏi có số liệu runtime phải query database hoặc gọi function trước.
- RAG chỉ dùng để biết chính sách, cách dùng, format trả lời và phạm vi vai trò.
- LLM không được tự sinh doanh thu, số booking, số user, số slot, số dư ví.

## User data
- Xe, ví, lịch sử đặt, tổng quan tài khoản phải lấy theo user đang đăng nhập.
- Nếu chưa đăng nhập, hướng dẫn đăng nhập.

## Owner data
- Chỉ lấy bãi thuộc owner đang đăng nhập.
- Với báo cáo doanh thu nên có nhận xét và câu hỏi tiếp theo.

## Admin data
- Admin có thể xem toàn hệ thống, nhưng câu trả lời nên tránh ID nội bộ.
- Với cảnh báo hệ thống, ưu tiên số lượng và gợi ý xử lý.
