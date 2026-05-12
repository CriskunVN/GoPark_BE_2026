// ─── Enum tất cả intent ───────────────────────────────────────────────────
export enum ChatbotIntent {
  // === Nhóm cần fetch data từ DB ===
  FIND_NEARBY = 'FIND_NEARBY', // tìm bãi gần tôi → query parking lots by location
  FIND_BEST = 'FIND_BEST', // tìm bãi tốt nhất → query top rated lots
  CHECK_BOOKING = 'CHECK_BOOKING', // xem lịch sử đặt → query bookings
  CANCEL_BOOKING = 'CANCEL_BOOKING', // hủy đặt → query + mutation
  CHECK_INVOICE = 'CHECK_INVOICE', // hóa đơn → query invoices
  CHECK_WALLET = 'CHECK_WALLET', // ví / số dư → query wallet
  CHECK_VEHICLES = 'CHECK_VEHICLES', // xe đã đăng ký → query vehicles

  // === Nhóm không cần data — AI trả lời trực tiếp ===
  BOOK_PARKING = 'BOOK_PARKING', // hướng dẫn đặt bãi (kèm tên)
  PAYMENT_GUIDE = 'PAYMENT_GUIDE', // hướng dẫn thanh toán
  OWNER_FEATURE = 'OWNER_FEATURE', // tính năng chủ bãi
  PROMOTION = 'PROMOTION', // khuyến mãi
  CONTACT = 'CONTACT', // liên hệ hỗ trợ
  OPENING_HOURS = 'OPENING_HOURS', // giờ mở cửa
  FREE_FORM = 'FREE_FORM', // fallback → gọi AI thuần

  VIEW_PARKING_DETAIL = 'VIEW_PARKING_DETAIL',   // xem chi tiết bãi
  ASK_CRITERIA = 'ASK_CRITERIA',                 // hỏi tiêu chí tìm bãi
  BOOK_WITH_DETAILS = 'BOOK_WITH_DETAILS',       // đặt có sẵn thông tin

  
}

// ─── Intents nào cần fetch DB data trước khi gọi AI ──────────────────────
// ✅ FIX: Thêm FIND_NEARBY và FIND_BEST vào DATA_REQUIRED_INTENTS
export const DATA_REQUIRED_INTENTS = new Set<ChatbotIntent>([
  ChatbotIntent.FIND_NEARBY,      // ✅ THÊM DÒNG NÀY
  ChatbotIntent.FIND_BEST,        // ✅ THÊM DÒNG NÀY
  ChatbotIntent.CHECK_BOOKING,
  ChatbotIntent.CANCEL_BOOKING,
  ChatbotIntent.CHECK_INVOICE,
  ChatbotIntent.CHECK_WALLET,
  ChatbotIntent.CHECK_VEHICLES,   // ✅ THÊM
]);

// ─── Intents yêu cầu đăng nhập (cần userId) ──────────────────────────────
export const LOGIN_REQUIRED_INTENTS = new Set<ChatbotIntent>([
  ChatbotIntent.CHECK_BOOKING,
  ChatbotIntent.CANCEL_BOOKING,
  ChatbotIntent.CHECK_INVOICE,
  ChatbotIntent.CHECK_WALLET,
  ChatbotIntent.CHECK_VEHICLES,
]);

// ─── Keyword map (ưu tiên từ dài → ngắn để tránh false positive) ─────────
const INTENT_KEYWORDS: Record<ChatbotIntent, string[]> = {
   [ChatbotIntent.FIND_NEARBY]: [
  'gần tôi', 'bãi gần tôi', 'tìm bãi gần', 'bãi đỗ gần', 'gần đây', 'gần nhất',
  'xung quanh', 'khu vực tôi', 'cạnh tôi', 'nearby', 'gần chỗ tôi',
  'bãi nào gần', 'chỗ đỗ gần', 'bãi đỗ xe gần', 'tìm chỗ đỗ', 'chỗ đỗ xe gần',
  'bãi gần đây nhất', 'bãi đỗ gần đây', 'tìm bãi đỗ', 'tìm bãi', 'chỗ đỗ', 'bãi đỗ',
  // không dấu
  'tim bai', 'bai gan', 'gan toi', 'gan day', 'bai do', 'cho do', 'tim cho do',
  'bai do xe', 'bai gan nhat', 'tim bai do', 'cho do xe', 'bai o dau',
],
[ChatbotIntent.FIND_BEST]: [
  'tốt nhất', 'rẻ nhất', 'giá tốt nhất', 'giá rẻ nhất', 'gợi ý bãi', 'bãi nào tốt',
  'bãi trống', 'recommend', 'bãi phù hợp', 'bãi đỗ tốt nhất', 'bãi nào ngon',
  'chỗ đỗ tốt nhất', 'bãi đỗ rẻ nhất', 'bãi đỗ phù hợp', 'bãi uy tín', 'bãi chất lượng',
  'nên đỗ ở đâu', 'gợi ý chỗ đỗ', 'bãi tốt nhất',
  // không dấu
  'tot nhat', 're nhat', 'gia re', 'goi y bai', 'bai nao tot', 'bai trong',
  'bai phu hop', 'bai uy tin', 'nen do o dau', 'bai nao ngon',
],
   [ChatbotIntent.VIEW_PARKING_DETAIL]: [
    'chi tiết', 'xem bãi', 'thông tin bãi', 'xem thử', 'detail'
  ],
  [ChatbotIntent.BOOK_PARKING]: [
    'đặt bãi', 'book bãi', 'tôi muốn đặt', 'đặt ngay', 'thuê bãi',
    'book chỗ', 'đặt xe tại', 'đặt tại', 'đặt chỗ',
    // không dấu
    'dat bai', 'book bai', 'dat cho', 'dat ngay', 'thue bai', 'dat xe tai',
  ],
  [ChatbotIntent.CHECK_BOOKING]: [
    'đặt của tôi', 'booking của tôi', 'lịch sử đặt', 'xem đặt chỗ', 'check booking',
    'đặt chỗ hiện tại', 'lịch sử booking', 'đặt chỗ của tôi', 'tôi đã đặt', 'xem booking',
    // không dấu
    'lich su dat', 'dat cua toi', 'booking cua toi', 'xem dat cho', 'dat cho cua toi',
  ],
  [ChatbotIntent.CANCEL_BOOKING]: [
    'hủy đặt', 'cancel booking', 'hủy chỗ', 'hủy booking', 'không muốn đặt nữa',
    'muốn hủy', 'hủy đặt chỗ',
    // không dấu
    'huy dat', 'huy cho', 'huy booking',
  ],
  [ChatbotIntent.CHECK_INVOICE]: [
    'hóa đơn của tôi', 'hoá đơn của tôi', 'xem hóa đơn', 'xem hoá đơn',
    'khiếu nại', 'thanh toán sai', 'phí sai', 'tính sai', 'hoàn tiền', 'refund',
    'invoice', 'bill của tôi',
    // không dấu
    'hoa don', 'xem hoa don', 'hoan tien',
  ],
  [ChatbotIntent.CHECK_WALLET]: [
    'số dư của tôi', 'ví của tôi', 'wallet', 'balance', 'nạp tiền', 'top up',
    'xem ví', 'số dư ví',
    // không dấu
    'so du', 'vi cua toi', 'xem vi', 'so du vi', 'nap tien',
  ],
  [ChatbotIntent.CHECK_VEHICLES]: [
    'xe của tôi', 'xe đã đăng ký', 'danh sách xe', 'xe tôi', 'phương tiện của tôi',
    'xe đăng ký', 'biển số xe', 'xe nào', 'xem xe',
    // không dấu
    'xe cua toi', 'danh sach xe', 'xe toi', 'xem xe', 'bien so xe', 'xe da dang ky',
  ],
  [ChatbotIntent.PAYMENT_GUIDE]: [
    'cách thanh toán',
    'thanh toán như thế nào',
    'cách trả tiền',
    'vnpay',
    'momo',
    'visa',
    'atm',
    'chuyển khoản',
    'hướng dẫn thanh toán',
  ],
  [ChatbotIntent.OWNER_FEATURE]: [
    'chủ bãi',
    'owner',
    'quản lý bãi',
    'tạo bãi',
    'đăng ký bãi',
    'doanh thu',
    'báo cáo bãi',
  ],
  [ChatbotIntent.PROMOTION]: [
    'khuyến mãi',
    'giảm giá',
    'discount',
    'coupon',
    'mã giảm',
    'promo',
    'ưu đãi',
    'voucher',
    'mã khuyến mãi',
  ],
  [ChatbotIntent.CONTACT]: [
    'liên hệ',
    'hỗ trợ',
    'support',
    'contact',
    'hotline',
    'tổng đài',
    'chat với người',
    'nhân viên',
    'gặp người thật',
  ],
  [ChatbotIntent.OPENING_HOURS]: [
    'giờ mở cửa',
    'mấy giờ',
    'đóng cửa',
    'giờ hoạt động',
    'thứ mấy',
    'ngày nghỉ',
    'cuối tuần',
  ],

  // ✅ THÊM KEY CHO ASK_CRITERIA (có thể để mảng rỗng vì intent này dùng nội bộ)
  [ChatbotIntent.ASK_CRITERIA]: [],
  
  // ✅ THÊM KEY CHO BOOK_WITH_DETAILS
  [ChatbotIntent.BOOK_WITH_DETAILS]: [
    'đặt cho tôi',
    'đặt giúp tôi',
    'tôi muốn đặt',
    'đặt bãi này',
  ],
  [ChatbotIntent.FREE_FORM]: [], // fallback — không có keyword
};

// ─── Thứ tự ưu tiên khi classify (DATA intents check trước) ──────────────
const PRIORITY_ORDER: ChatbotIntent[] = [
   ChatbotIntent.BOOK_PARKING,
  ChatbotIntent.CANCEL_BOOKING,
  ChatbotIntent.CHECK_BOOKING,
  ChatbotIntent.CHECK_INVOICE,
  ChatbotIntent.CHECK_WALLET,
  ChatbotIntent.CHECK_VEHICLES,
  ChatbotIntent.FIND_BEST,
  ChatbotIntent.FIND_NEARBY,
  ChatbotIntent.PAYMENT_GUIDE,
  ChatbotIntent.OWNER_FEATURE,
  ChatbotIntent.PROMOTION,
  ChatbotIntent.CONTACT,
  ChatbotIntent.OPENING_HOURS,
];

// ─── Classifier chính ─────────────────────────────────────────────────────
export function classifyIntent(message: string): ChatbotIntent {
  const lower = message.toLowerCase().normalize('NFC');
  if (lower.includes('đặt bãi') || lower.includes('book bãi') || lower.includes('đặt chỗ')) {
  return ChatbotIntent.BOOK_PARKING;
}

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

// ─── Helper: intent này có cần đăng nhập không? ───────────────────────────
export function requiresLogin(intent: ChatbotIntent): boolean {
  return LOGIN_REQUIRED_INTENTS.has(intent);
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
  Record<
    ChatbotIntent,
    { table: string; orderBy?: string; limit: number; requiresUserId?: boolean }
  >
> = {
  [ChatbotIntent.FIND_NEARBY]: {
    table: 'parking_lots',
    orderBy: 'available_slots',  // ✅ Sửa thành available_slots
    limit: 5,
    requiresUserId: false,
  },
  [ChatbotIntent.FIND_BEST]: {
    table: 'parking_lots',
    orderBy: 'rating',
    limit: 5,
    requiresUserId: false,
  },
  [ChatbotIntent.CHECK_BOOKING]: {
    table: 'bookings',
    orderBy: 'created_at',
    limit: 3,
    requiresUserId: true,
  },
  [ChatbotIntent.CANCEL_BOOKING]: {
    table: 'bookings',
    orderBy: 'created_at',
    limit: 3,
    requiresUserId: true,
  },
  [ChatbotIntent.CHECK_INVOICE]: {
    table: 'invoices',
    orderBy: 'created_at',
    limit: 3,
    requiresUserId: true,
  },
  [ChatbotIntent.CHECK_WALLET]: {
    table: 'wallets',
    orderBy: 'updated_at',
    limit: 1,
    requiresUserId: true,
  },
  [ChatbotIntent.CHECK_VEHICLES]: {
    table: 'vehicles',
    orderBy: 'id',
    limit: 10,
    requiresUserId: true,
  },
};