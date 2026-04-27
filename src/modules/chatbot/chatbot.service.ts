import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  ChatbotIntent,
  classifyIntent,
  requiresData,
  INTENT_DB_CONFIG,
  extractParkingName,
} from './Chatbot.intent';

// ─── System prompt ────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Bạn là trợ lý ảo cho GoPark — hệ thống tìm và đặt bãi đỗ xe.
Giữ vai trò chuyên nghiệp, thân thiện, trả lời bằng tiếng Việt rõ ràng, ngắn gọn.

Thông tin nền:
- Tên: GoPark — Hệ thống tìm và đặt bãi đỗ xe.
- Vai trò: Admin, Chủ bãi, Người dùng.
- CEO: Hà Tây Nguyên.

Quy tắc phản hồi:
- KHÔNG chỉ trả về một từ như "thành công". Luôn có: (1) xác nhận; (2) tóm tắt chi tiết; (3) bước tiếp theo.
- Khi nhận được [DỮ LIỆU HỆ THỐNG], hãy phân tích và trình bày thông tin đó cho người dùng một cách thân thiện.
- Chỉ hiển thị tối đa 3 kết quả, sắp xếp theo mức độ liên quan.
- Với lỗi: giải thích ngắn + 1-2 bước khắc phục.
- KHÔNG tiết lộ thông tin kỹ thuật (token, raw SQL, cấu trúc DB).
- KHÔNG bịa đặt dữ liệu nếu [DỮ LIỆU HỆ THỐNG] trống.`;

// ─── Static intent responses (không cần AI) ───────────────────────────────
const STATIC_RESPONSES: Partial<Record<ChatbotIntent, string>> = {
  [ChatbotIntent.CONTACT]: `📞 **Liên hệ hỗ trợ GoPark**

- **Hotline**: 1800-GOPARK (miễn phí)
- **Email**: support@gopark.id.vn
- **Chat trực tiếp**: Nhấn nút "Chat với nhân viên" trong app
- **Thời gian**: 7:00 – 22:00, tất cả các ngày

Bạn cần hỗ trợ vấn đề gì cụ thể không?`,

  [ChatbotIntent.PAYMENT_GUIDE]: `💳 **Hướng dẫn thanh toán GoPark**

GoPark hỗ trợ các phương thức:
1. **Ví GoPark** — nạp trước, thanh toán nhanh
2. **VNPay** — ATM nội địa, Visa/Master
3. **Chuyển khoản** — sau khi đặt chỗ thành công

Để thanh toán: Chọn bãi → Đặt chỗ → Chọn phương thức → Xác nhận.`,

  [ChatbotIntent.OWNER_FEATURE]: `🏢 **Tính năng dành cho Chủ bãi**

1. **Đăng ký bãi**: Vào App → Chủ bãi → Thêm bãi mới
2. **Quản lý giá**: Cài đặt giá theo giờ/ngày/tháng
3. **Báo cáo doanh thu**: Xem thống kê real-time
4. **Quản lý booking**: Duyệt/từ chối đặt chỗ

Liên hệ support@gopark.id.vn để được hỗ trợ đăng ký.`,

  [ChatbotIntent.PROMOTION]: `🎁 **Khuyến mãi GoPark**

Hiện tại chưa có thông tin khuyến mãi mới nhất.
Theo dõi app GoPark hoặc fanpage để cập nhật ưu đãi sớm nhất!`,

  [ChatbotIntent.OPENING_HOURS]: `🕐 **Giờ hoạt động**

GoPark hoạt động **24/7** — bạn có thể đặt bãi bất kỳ lúc nào.
Tuy nhiên, giờ mở cửa của từng bãi đỗ sẽ khác nhau — hãy kiểm tra trang chi tiết bãi khi đặt chỗ.`,
};

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);
  private readonly groqApiKey: string;
  private readonly geminiKey: string;
  private sessions: Map<string, any[]> = new Map();

  private statusCache: {
    result: { groq: { ok: boolean; info?: string }; gemini: { ok: boolean | null; info?: string } };
    expiresAt: number;
  } | null = null;
  private readonly CACHE_TTL_MS = 10 * 60 * 1000;

  constructor(private readonly dataSource: DataSource) {
    // Hỗ trợ cả GROQ_API_KEY và GORQ_API_KEY (typo cũ)
    this.groqApiKey = process.env.GROQ_API_KEY || process.env.GORQ_API_KEY || '';
    this.geminiKey =
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      '';

    if (!this.groqApiKey) {
      this.logger.warn('GROQ_API_KEY is not set; Groq requests will fail.');
    }
    if (!this.geminiKey) {
      this.logger.log('GEMINI/GOOGLE_API_KEY not set; Gemini will be skipped.');
    }
  }

  // ─── Session management ──────────────────────────────────────────────────
  createSession(messages: any[]): string {
    const id = randomUUID();
    this.sessions.set(id, messages);
    return id;
  }

  getSessionMessages(id: string): any[] | undefined {
    return this.sessions.get(id);
  }

  // ─── Main entry: smart complete ──────────────────────────────────────────
  /**
   * Nhận messages array, classify intent từ tin nhắn cuối,
   * nếu cần data thì query DB → inject vào context → gọi AI.
   * Nếu có static response → trả luôn không tốn API.
   */
  async complete(messages: any[], userId?: string): Promise<string> {
    const lastMessage = this.extractLastUserMessage(messages);
    const intent = classifyIntent(lastMessage);

    this.logger.debug(`Intent: ${intent} | Message: "${lastMessage}"`);

    // 1. Static response (không cần AI)
    if (STATIC_RESPONSES[intent]) {
      return STATIC_RESPONSES[intent]!;
    }

    // 2. Cần fetch DB data
    let enrichedMessages = messages;
    if (requiresData(intent) && userId) {
      const dbData = await this.fetchDataForIntent(intent, userId, lastMessage);
      enrichedMessages = this.injectDataContext(messages, intent, dbData);
    } else if (requiresData(intent) && !userId) {
      // Không có userId — yêu cầu đăng nhập
      return this.buildLoginRequiredResponse(intent);
    }

    // 3. Gọi AI với context đã được enriched
    return this.callAI(enrichedMessages);
  }

  // ─── Fetch DB data dựa theo intent ───────────────────────────────────────
  private async fetchDataForIntent(
    intent: ChatbotIntent,
    userId: string,
    message: string,
  ): Promise<any[]> {
    const config = INTENT_DB_CONFIG[intent];
    if (!config) return [];

    try {
      let query = this.dataSource
        .createQueryBuilder()
        .from(config.table, 't')
        .limit(config.limit);

      // Thêm filter theo userId nếu là data cá nhân
      const userOwnedTables = ['bookings', 'invoices', 'wallets'];
      if (userOwnedTables.includes(config.table)) {
        query = query.where('t.user_id = :userId', { userId });
      }

      // Parking lots: tìm gần nhất hoặc tốt nhất
      if (intent === ChatbotIntent.FIND_NEARBY || intent === ChatbotIntent.FIND_BEST) {
        const orderField =
          intent === ChatbotIntent.FIND_BEST ? 't.rating' : 't.created_at';
        query = query.orderBy(orderField, 'DESC');
      } else if (config.orderBy) {
        query = query.orderBy(`t.${config.orderBy}`, 'DESC');
      }

      const rows = await query.getRawMany();
      return rows;
    } catch (err) {
      this.logger.error(`DB query failed for intent ${intent}`, err);
      return [];
    }
  }

  // ─── Inject DB data vào messages context ─────────────────────────────────
  private injectDataContext(
    messages: any[],
    intent: ChatbotIntent,
    data: any[],
  ): any[] {
    const intentLabels: Partial<Record<ChatbotIntent, string>> = {
      [ChatbotIntent.CHECK_BOOKING]: 'lịch sử đặt chỗ',
      [ChatbotIntent.CANCEL_BOOKING]: 'các booking hiện tại',
      [ChatbotIntent.CHECK_INVOICE]: 'hóa đơn',
      [ChatbotIntent.CHECK_WALLET]: 'thông tin ví',
      [ChatbotIntent.FIND_NEARBY]: 'bãi đỗ gần đây',
      [ChatbotIntent.FIND_BEST]: 'bãi đỗ phù hợp nhất',
    };

    const label = intentLabels[intent] || 'dữ liệu hệ thống';

    const dataContext =
      data.length > 0
        ? `[DỮ LIỆU HỆ THỐNG — ${label} (${data.length} kết quả)]:\n${JSON.stringify(data, null, 2)}`
        : `[DỮ LIỆU HỆ THỐNG — ${label}]: Không tìm thấy dữ liệu nào.`;

    // Inject vào message cuối cùng của user
    const enriched = [...messages];
    const lastIdx = enriched.length - 1;
    if (enriched[lastIdx]?.role === 'user') {
      enriched[lastIdx] = {
        ...enriched[lastIdx],
        content: `${enriched[lastIdx].content}\n\n${dataContext}`,
      };
    } else {
      enriched.push({ role: 'user', content: dataContext });
    }

    return enriched;
  }

  // ─── Gọi AI (Gemini first, fallback Groq) ────────────────────────────────
  private async callAI(messages: any[]): Promise<string> {
    if (this.geminiKey) {
      try {
        const result = await this.generateWithGemini(messages);
        if (result) return result;
      } catch (err) {
        this.logger.warn('Gemini failed, falling back to Groq', err);
      }
    }

    let result = '';
    for await (const chunk of this.streamChat(messages)) {
      result += chunk;
    }
    return result;
  }

  // ─── Groq streaming ───────────────────────────────────────────────────────
  async *streamChat(messages: any[]): AsyncGenerator<string, void, unknown> {
    const { Groq } = await import('groq-sdk').catch((e) => {
      this.logger.error('Failed to import groq-sdk', e);
      throw e;
    });

    const groq = new Groq({ apiKey: this.groqApiKey });
    const fullMessages = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];

    const completion = await groq.chat.completions.create({
      messages: fullMessages,
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7,
      max_completion_tokens: 1024,
      top_p: 1,
      stream: true,
      stop: null,
    });

    for await (const chunk of completion) {
      const content = chunk.choices?.[0]?.delta?.content || '';
      if (content) yield content;
    }
  }

  // ─── SSE stream to response ───────────────────────────────────────────────
  async streamToResponse(messages: any[], res: any, userId?: string) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (res.flushHeaders) res.flushHeaders();

    try {
      const lastMessage = this.extractLastUserMessage(messages);
      const intent = classifyIntent(lastMessage);

      // Static response → stream as single chunk
      if (STATIC_RESPONSES[intent]) {
        const payload = `data: ${JSON.stringify({ text: STATIC_RESPONSES[intent] })}\n\n`;
        res.write(payload);
        return;
      }

      // Enrich with DB data if needed
      let enrichedMessages = messages;
      if (requiresData(intent)) {
        if (!userId) {
          const loginMsg = this.buildLoginRequiredResponse(intent);
          res.write(`data: ${JSON.stringify({ text: loginMsg })}\n\n`);
          return;
        }
        const dbData = await this.fetchDataForIntent(intent, userId, lastMessage);
        enrichedMessages = this.injectDataContext(messages, intent, dbData);
      }

      for await (const chunk of this.streamChat(enrichedMessages)) {
        res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
      }
    } catch (err) {
      this.logger.error('Error in streamToResponse', err);
      res.write(`event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`);
    } finally {
      res.write('event: done\ndata: {}\n\n');
      res.end();
    }
  }

  // ─── Gemini ───────────────────────────────────────────────────────────────
  private async generateWithGemini(messages: any[]): Promise<string> {
    const fullMessages = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];
    const prompt = fullMessages
      .map((m) => (m.role ? `${m.role}: ${m.content}` : String(m.content)))
      .join('\n\n');

    const mod = await import('@google/generative-ai');
    const GoogleGenAI = (mod as any).GoogleGenAI || (mod as any).default || mod;
    const ai = new GoogleGenAI({ apiKey: this.geminiKey });

    const model =
      process.env.GOOGLE_GEMINI_MODEL || 'gemini-1.5-flash';

    const response = await ai.models.generateContent({
      model,
      contents: prompt,
    });

    const text = response?.text ?? response?.output?.[0]?.content ?? '';
    return String(text || '');
  }

  // ─── Health check ─────────────────────────────────────────────────────────
  async checkModels(): Promise<{
    groq: { ok: boolean; info?: string };
    gemini: { ok: boolean | null; info?: string };
  }> {
    const now = Date.now();
    if (this.statusCache && now < this.statusCache.expiresAt) {
      return this.statusCache.result;
    }

    const groqStatus: { ok: boolean; info: string } = { ok: false, info: '' };
    const geminiStatus: { ok: boolean | null; info: string } = { ok: null, info: '' };

    // Check Groq
    try {
      const { Groq } = await import('groq-sdk');
      const groq = new Groq({ apiKey: this.groqApiKey });
      await groq.chat.completions.create({
        messages: [
          { role: 'system', content: 'Health check' },
          { role: 'user', content: 'Ping' },
        ],
        model: 'llama-3.3-70b-versatile',
        temperature: 0,
        max_completion_tokens: 1,
        stream: false,
      });
      groqStatus.ok = true;
      groqStatus.info = 'responded';
    } catch (e: unknown) {
      groqStatus.ok = false;
      groqStatus.info = e instanceof Error ? e.message : String(e);
    }

    // Check Gemini
    if (!this.geminiKey) {
      geminiStatus.ok = null;
      geminiStatus.info = 'GEMINI/GOOGLE_API_KEY not set';
    } else {
      try {
        const mod = await import('@google/generative-ai');
        const GoogleGenAI = (mod as any).GoogleGenAI || (mod as any).default || mod;
        const ai = new GoogleGenAI({ apiKey: this.geminiKey });
        const model = process.env.GOOGLE_GEMINI_MODEL || 'gemini-1.5-flash';
        const response = await ai.models.generateContent({
          model,
          contents: 'Ping',
        });
        const text = response?.text ?? '';
        geminiStatus.ok = Boolean(text);
        geminiStatus.info = text ? 'responded' : 'no-text';
      } catch (e: unknown) {
        geminiStatus.ok = false;
        geminiStatus.info = e instanceof Error ? e.message : String(e);
      }
    }

    const result = { groq: groqStatus, gemini: geminiStatus };
    this.statusCache = { result, expiresAt: now + this.CACHE_TTL_MS };
    return result;
  }

  // ─── Utilities ────────────────────────────────────────────────────────────
  private extractLastUserMessage(messages: any[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'user') {
        return String(messages[i].content || '');
      }
    }
    return '';
  }

  private buildLoginRequiredResponse(intent: ChatbotIntent): string {
    const intentDescriptions: Partial<Record<ChatbotIntent, string>> = {
      [ChatbotIntent.CHECK_BOOKING]: 'xem lịch sử đặt chỗ',
      [ChatbotIntent.CANCEL_BOOKING]: 'hủy đặt chỗ',
      [ChatbotIntent.CHECK_INVOICE]: 'xem hóa đơn',
      [ChatbotIntent.CHECK_WALLET]: 'xem số dư ví',
      [ChatbotIntent.FIND_NEARBY]: 'tìm bãi gần bạn',
      [ChatbotIntent.FIND_BEST]: 'tìm bãi phù hợp',
    };

    const action = intentDescriptions[intent] || 'thực hiện yêu cầu này';
    return `🔐 Để ${action}, bạn cần đăng nhập vào tài khoản GoPark trước.\n\nNhấn **Đăng nhập** hoặc **Đăng ký** để tiếp tục.`;
  }
}