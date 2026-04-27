// ─── Enum tất cả intent ───────────────────────────────────────────────────
export enum ChatbotIntent {
  // === Nhóm cần fetch data từ DB ===
  FIND_NEARBY     = 'FIND_NEARBY',     // tìm bãi gần tôi → query parking lots by location
  FIND_BEST       = 'FIND_BEST',       // tìm bãi tốt nhất → query top rated lots
  CHECK_BOOKING   = 'CHECK_BOOKING',   // xem lịch sử đặt → query bookings
  CANCEL_BOOKING  = 'CANCEL_BOOKING',  // hủy đặt → query + mutation
  CHECK_INVOICE   = 'CHECK_INVOICE',   // hóa đơn → query invoices
  CHECK_WALLET    = 'CHECK_WALLET',    // ví / số dư → query wallet

  // === Nhóm không cần data — AI trả lời trực tiếp ===
  BOOK_PARKING    = 'BOOK_PARKING',    // hướng dẫn đặt bãi (kèm tên)
  PAYMENT_GUIDE   = 'PAYMENT_GUIDE',   // hướng dẫn thanh toán
  OWNER_FEATURE   = 'OWNER_FEATURE',   // tính năng chủ bãi
  PROMOTION       = 'PROMOTION',       // khuyến mãi
  CONTACT         = 'CONTACT',         // liên hệ hỗ trợ
  OPENING_HOURS   = 'OPENING_HOURS',   // giờ mở cửa
  FREE_FORM       = 'FREE_FORM',       // fallback → gọi AI thuần
}

// ─── Intents nào cần fetch DB data trước khi gọi AI ──────────────────────
export const DATA_REQUIRED_INTENTS = new Set<ChatbotIntent>([
  ChatbotIntent.FIND_NEARBY,
  ChatbotIntent.FIND_BEST,
  ChatbotIntent.CHECK_BOOKING,
  ChatbotIntent.CANCEL_BOOKING,
  ChatbotIntent.CHECK_INVOICE,
  ChatbotIntent.CHECK_WALLET,
]);

// ─── Keyword map (ưu tiên từ dài → ngắn để tránh false positive) ─────────
const INTENT_KEYWORDS: Record<ChatbotIntent, string[]> = {
  [ChatbotIntent.FIND_NEARBY]: [
    'gần tôi', 'gần đây', 'gần nhất', 'bãi gần', 'xung quanh',
    'khu vực tôi', 'cạnh tôi', 'nearby', 'gần chỗ tôi',
  ],
  [ChatbotIntent.FIND_BEST]: [
    'phù hợp nhất', 'tốt nhất', 'rẻ nhất', 'giá tốt nhất', 'giá rẻ nhất',
    'gợi ý bãi', 'bãi nào tốt', 'bãi trống', 'recommend', 'tìm bãi',
    'giá rẻ', 'bãi phù hợp',
  ],
  [ChatbotIntent.BOOK_PARKING]: [
    'đặt bãi', 'book bãi', 'tôi muốn đặt', 'đặt ngay',
    'thuê bãi', 'book chỗ', 'đặt xe tại', 'đặt tại', 'đặt chỗ',
  ],
  [ChatbotIntent.CHECK_BOOKING]: [
    'đặt của tôi', 'booking của tôi', 'lịch sử đặt', 'xem đặt chỗ',
    'check booking', 'đặt chỗ hiện tại', 'lịch sử booking',
    'đặt chỗ của tôi', 'tôi đã đặt', 'xem booking',
  ],
  [ChatbotIntent.CANCEL_BOOKING]: [
    'hủy đặt', 'cancel booking', 'hủy chỗ', 'hủy booking',
    'không muốn đặt nữa', 'muốn hủy', 'hủy đặt chỗ',
  ],
  [ChatbotIntent.CHECK_INVOICE]: [
    'hóa đơn của tôi', 'hoá đơn của tôi', 'xem hóa đơn', 'xem hoá đơn',
    'khiếu nại', 'thanh toán sai', 'phí sai', 'tính sai',
    'hoàn tiền', 'refund', 'invoice', 'bill của tôi',
  ],
  [ChatbotIntent.CHECK_WALLET]: [
    'số dư của tôi', 'ví của tôi', 'wallet', 'balance',
    'nạp tiền', 'top up', 'xem ví', 'số dư ví',
  ],
  [ChatbotIntent.PAYMENT_GUIDE]: [
    'cách thanh toán', 'thanh toán như thế nào', 'cách trả tiền',
    'vnpay', 'momo', 'visa', 'atm', 'chuyển khoản', 'hướng dẫn thanh toán',
  ],
  [ChatbotIntent.OWNER_FEATURE]: [
    'chủ bãi', 'owner', 'quản lý bãi', 'tạo bãi', 'đăng ký bãi',
    'doanh thu', 'báo cáo bãi',
  ],
  [ChatbotIntent.PROMOTION]: [
    'khuyến mãi', 'giảm giá', 'discount', 'coupon', 'mã giảm',
    'promo', 'ưu đãi', 'voucher', 'mã khuyến mãi',
  ],
  [ChatbotIntent.CONTACT]: [
    'liên hệ', 'hỗ trợ', 'support', 'contact', 'hotline',
    'tổng đài', 'chat với người', 'nhân viên', 'gặp người thật',
  ],
  [ChatbotIntent.OPENING_HOURS]: [
    'giờ mở cửa', 'mấy giờ', 'đóng cửa', 'giờ hoạt động',
    'thứ mấy', 'ngày nghỉ', 'cuối tuần',
  ],
  [ChatbotIntent.FREE_FORM]: [], // fallback — không có keyword
};

// ─── Thứ tự ưu tiên khi classify (DATA intents check trước) ──────────────
const PRIORITY_ORDER: ChatbotIntent[] = [
  ChatbotIntent.CANCEL_BOOKING,  // must check before CHECK_BOOKING
  ChatbotIntent.CHECK_BOOKING,
  ChatbotIntent.CHECK_INVOICE,
  ChatbotIntent.CHECK_WALLET,
  ChatbotIntent.FIND_NEARBY,
  ChatbotIntent.FIND_BEST,
  ChatbotIntent.BOOK_PARKING,
  ChatbotIntent.PAYMENT_GUIDE,
  ChatbotIntent.OWNER_FEATURE,
  ChatbotIntent.PROMOTION,
  ChatbotIntent.CONTACT,
  ChatbotIntent.OPENING_HOURS,
];

// ─── Classifier chính ─────────────────────────────────────────────────────
export function classifyIntent(message: string): ChatbotIntent {
  const lower = message.toLowerCase().normalize('NFC');

  for (const intent of PRIORITY_ORDER) {
    const keywords = INTENT_KEYWORDS[intent];
    for (const kw of keywords) {
      if (lower.includes(kw)) return intent;
    }
  }

  return ChatbotIntent.FREE_FORM;
}

// ─── Helper: intent này có cần data không? ────────────────────────────────
export function requiresData(intent: ChatbotIntent): boolean {
  return DATA_REQUIRED_INTENTS.has(intent);
}

// ─── Extract tên bãi từ câu đặt ──────────────────────────────────────────
export function extractParkingName(message: string): string | null {
  const patterns = [
    /(?:đặt bãi|đặt tại|thuê bãi|book bãi|đặt chỗ tại|đặt xe tại)\s+(.+)/i,
    /(?:tôi muốn đặt)\s+(.+)/i,
  ];
  for (const p of patterns) {
    const m = message.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

// ─── Intent → DB table/action mapping ────────────────────────────────────
export const INTENT_DB_CONFIG: Partial<
  Record<ChatbotIntent, { table: string; orderBy?: string; limit: number }>
> = {
  [ChatbotIntent.FIND_NEARBY]: {
    table: 'parking_lots',
    orderBy: 'created_at',
    limit: 3,
  },
  [ChatbotIntent.FIND_BEST]: {
    table: 'parking_lots',
    orderBy: 'rating',
    limit: 3,
  },
  [ChatbotIntent.CHECK_BOOKING]: {
    table: 'bookings',
    orderBy: 'created_at',
    limit: 3,
  },
  [ChatbotIntent.CANCEL_BOOKING]: {
    table: 'bookings',
    orderBy: 'created_at',
    limit: 3,
  },
  [ChatbotIntent.CHECK_INVOICE]: {
    table: 'invoices',
    orderBy: 'created_at',
    limit: 3,
  },
  [ChatbotIntent.CHECK_WALLET]: {
    table: 'wallets',
    orderBy: 'updated_at',
    limit: 1,
  },
};