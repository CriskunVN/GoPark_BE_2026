import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

const SYSTEM_PROMPT = `Bạn là trợ lý ảo cho GoPark — hệ thống tìm và đặt bãi đỗ xe cho người dùng.
Giữ vai trò chuyên nghiệp, thân thiện, và trả lời bằng tiếng Việt rõ ràng, ngắn gọn.
Luôn nắm các thông tin sau khi phản hồi:
- Tên web: GoPark — Hệ thống tìm và đặt bãi đỗ xe cho người dùng.
- Mô tả ngắn: Ứng dụng tương tự Grab nhưng tập trung vào dịch vụ bãi đỗ; có các vai trò: Admin, Chủ bãi (nhà cung cấp bãi đỗ), Người dùng.
- CEO: Hà Tây Nguyên.

Quy tắc phản hồi:
- KHÔNG chỉ trả về một từ như "thành công". Khi hành động backend báo thành công, trả về một thông điệp người dùng dễ hiểu gồm: (1) Dòng xác nhận ngắn; (2) Tóm tắt chi tiết kết quả (ví dụ: tên bãi, mã/ID, thời gian); (3) Bước tiếp theo hoặc CTA.
- Với lỗi hoặc cảnh báo: giải thích nguyên nhân ngắn gọn và cung cấp 1–2 bước khắc phục hoặc liên hệ hỗ trợ.
- Giọng điệu: thân thiện, rõ ràng, chuyên nghiệp; không dùng biệt ngữ kỹ thuật cho người dùng cuối; dành hướng dẫn chi tiết hơn cho Admin/Chủ bãi.
- Không đưa thông tin nhạy cảm (mật khẩu, token). Nếu không đủ dữ liệu, yêu cầu thêm thông tin cụ thể.

Ví dụ ngắn:
- Hoàn tất — Bãi đỗ "Bãi A" đã được đăng thành công. ID: 12345. Bạn có thể quản lý bãi tại Trang Quản lý.
- Hoàn tất — Đặt chỗ tại "Bãi A" vào 15/04/2026 09:30 đã xác nhận. Mã đặt chỗ: BK-98765.`;

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);
  private gorqapi: string;
  private geminiKey: string;
  private sessions: Map<string, any[]> = new Map();

  // ─── Status cache (10 phút) ───────────────────────────────────────────────
  private statusCache: {
    result: {
      groq: { ok: boolean; info?: string };
      gemini: { ok: boolean | null; info?: string };
    };
    expiresAt: number;
  } | null = null;

  private readonly CACHE_TTL_MS = 10 * 60 * 1000; // 10 phút
  // ─────────────────────────────────────────────────────────────────────────

  constructor() {
    this.gorqapi = process.env.GORQ_API_KEY || '';
    this.geminiKey = process.env.GEMINI_API_KEY || '';

    if (!this.gorqapi) {
      this.logger.warn('GORQ_API_KEY is not set; Groq requests will fail.');
    }
    if (!this.geminiKey) {
      this.logger.log('GEMINI_API_KEY not set; Gemini will be skipped.');
    }
  }

  createSession(messages: any[]): string {
    const id = randomUUID();
    this.sessions.set(id, messages);
    return id;
  }

  getSessionMessages(id: string): any[] | undefined {
    return this.sessions.get(id);
  }

  async *streamChat(messages: any[]): AsyncGenerator<string, void, unknown> {
    const { Groq } = await import('groq-sdk').catch((e) => {
      this.logger.error('Failed to import groq-sdk. Make sure it is installed.', e);
      throw e;
    });

    const groq = new Groq({ apiKey: this.gorqapi });
    const fullMessages = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];

    const chatCompletion = await groq.chat.completions.create({
      messages: fullMessages,
      model: 'llama-3.3-70b-versatile',
      temperature: 1,
      max_completion_tokens: 1024,
      top_p: 1,
      stream: true,
      stop: null,
    });

    for await (const chunk of chatCompletion) {
      const content = chunk.choices?.[0]?.delta?.content || '';
      if (content) yield content;
    }
  }

  async streamToResponse(messages: any[], res: any) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (res.flushHeaders) res.flushHeaders();

    try {
      for await (const chunk of this.streamChat(messages)) {
        const payload = `data: ${JSON.stringify({ text: chunk })}\n\n`;
        res.write(payload);
      }
    } catch (err) {
      this.logger.error('Error streaming from Groq', err);
      const errPayload = `event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`;
      res.write(errPayload);
    } finally {
      res.write('event: done\ndata: {}\n\n');
      res.end();
    }
  }

  async complete(messages: any[]): Promise<string> {
    if (this.geminiKey) {
      try {
        const geminiResponse = await this.generateWithGemini(messages);
        if (geminiResponse) return geminiResponse;
      } catch (err) {
        this.logger.error('Gemini generation failed, falling back to Groq', err);
      }
    }

    let result = '';
    for await (const chunk of this.streamChat(messages)) {
      result += chunk;
    }
    return result;
  }

  async checkModels(): Promise<{
    groq: { ok: boolean; info?: string };
    gemini: { ok: boolean | null; info?: string };
  }> {
    const now = Date.now();

    // Trả cache nếu còn hạn
    if (this.statusCache && now < this.statusCache.expiresAt) {
      this.logger.debug('checkModels: returning cached result');
      return this.statusCache.result;
    }

    const groqStatus: { ok: boolean; info: string } = { ok: false, info: '' };
    const geminiStatus: { ok: boolean | null; info: string } = { ok: null, info: '' };

    // Check Groq
    try {
      const { Groq } = await import('groq-sdk');
      const groq = new Groq({ apiKey: this.gorqapi });
      const probe = await groq.chat.completions.create({
        messages: [
          { role: 'system', content: 'Health check' },
          { role: 'user', content: 'Ping' },
        ],
        model: 'llama-3.3-70b-versatile',
        temperature: 0,
        max_completion_tokens: 1,
        stream: false,
      });
      const firstChoice: any = probe?.choices?.[0];
      const text = firstChoice?.message?.content ?? firstChoice?.delta?.content ?? '';
      groqStatus.ok = true;
      groqStatus.info = text ? 'responded' : 'no-text';
    } catch (e: unknown) {
      groqStatus.ok = false;
      groqStatus.info = e instanceof Error ? e.message : String(e);
    }

    // Check Gemini
    if (!this.geminiKey) {
      geminiStatus.ok = null;
      geminiStatus.info = 'GEMINI_API_KEY not set';
    } else {
      try {
        const mod = await import('@google/generative-ai');
        const GoogleGenAI = (mod as any).GoogleGenAI || (mod as any).default || mod;
        const ai = new GoogleGenAI({ apiKey: this.geminiKey });
        const response = await ai.models.generateContent({
          model: 'gemini-3.3-mini',
          contents: 'Ping',
        });
        const text = response?.text ?? response?.output?.[0]?.content ?? '';
        geminiStatus.ok = Boolean(text);
        geminiStatus.info = text ? 'responded' : 'no-text';
      } catch (e: unknown) {
        geminiStatus.ok = false;
        geminiStatus.info = e instanceof Error ? e.message : String(e);
      }
    }

    const result = { groq: groqStatus, gemini: geminiStatus };

    // Lưu cache 10 phút
    this.statusCache = { result, expiresAt: now + this.CACHE_TTL_MS };

    return result;
  }

  private async generateWithGemini(messages: any[]): Promise<string> {
    const fullMessages = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];
    const prompt = fullMessages
      .map((m) => (m.role ? `${m.role}: ${m.content}` : String(m.content)))
      .join('\n\n');

    try {
      const mod = await import('@google/generative-ai');
      const GoogleGenAI = (mod as any).GoogleGenAI || (mod as any).default || mod;
      const ai = new GoogleGenAI({ apiKey: this.geminiKey });

      const response = await ai.models.generateContent({
        model: 'gemini-3.3-mini',
        contents: prompt,
      });

      const text = response?.text ?? response?.output?.[0]?.content ?? '';
      return String(text || '');
    } catch (err: unknown) {
      const errMsg =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null
            ? JSON.stringify(err)
            : String(err);
      this.logger.debug(`Gemini client not available or failed: ${errMsg}`);
      throw err;
    }
  }
}