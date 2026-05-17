import { Injectable, Logger, Optional } from '@nestjs/common';
import { DataSource, Like, Not, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import Groq from 'groq-sdk';
import { ParkingLot } from '../parking-lot/entities/parking-lot.entity';
import { ChatbotStateService } from './chatbot-state.service';
import { classifyIntent, requiresData, INTENT_DB_CONFIG, extractParkingName, ChatbotIntent } from './Chatbot.intent';
import { ChatbotSession } from './entities/chatbot-session.entity';
import { ChatbotGuideService } from './chatbot-guide.service';
import { ChatbotKnowledgeService } from './chatbot-knowledge.service';

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);
  private groq: Groq | null = null;
  private readonly maxSessionsPerUser = 20;
  private readonly groqModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  private readonly geminiModel = (process.env.GOOGLE_GEMINI_MODEL || 'gemini-2.0-flash').replace(/^models\//, '');

  constructor(
    private readonly dataSource: DataSource,
    private readonly stateService: ChatbotStateService,
    private readonly guideService: ChatbotGuideService,
    @InjectRepository(ChatbotSession)
    private readonly sessionRepo: Repository<ChatbotSession>,
    @Optional()
    private readonly knowledgeService?: ChatbotKnowledgeService,
  ) {
    const apiKey = process.env.GROQ_API_KEY || process.env.GORQ_API_KEY;
    if (!apiKey) {
      this.logger.warn('GROQ_API_KEY missing, chatbot chạy chế độ fallback');
    } else {
      this.groq = new Groq({ apiKey });
      this.logger.log('Groq initialized successfully');
    }
  }

  async processMessage(
    messages: { role: string; content: string }[],
    userId?: string,
    context?: any,
  ): Promise<{
    text: string;
    action?: string;
    data?: any;
    redirectUrl?: string;
  }> {
  try {
    // Điều phối chính cho USER chatbot: phân intent, query data, đặt bãi hoặc chuyển sang RAG/LLM.
    // Lấy câu cuối của người dùng
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || '';
    const intent = classifyIntent(lastUserMessage);
    this.logger.log(`Intent: ${intent} | Message: ${lastUserMessage}`);
    const session = userId ? this.stateService.getSession(userId) : undefined;
    const sessionContext = session?.context ?? {};
    const sessionPendingBooking = sessionContext.pendingBooking ?? {};
    const shouldContinueBooking =
      session?.step === 'awaiting_booking_details' &&
      this.isBookingContinuationMessage(lastUserMessage, sessionPendingBooking);
    if (this.isClearlyOffTopic(lastUserMessage) && !shouldContinueBooking) {
      return { text: this.getOffTopicResponse('user') };
    }
    if (session?.step === 'awaiting_booking_details' && this.isBookingCancelMessage(lastUserMessage)) {
      this.stateService.deleteSession(userId!);
      return { text: 'Mình đã thoát khỏi form đặt bãi. Bạn có thể hỏi tiếp về bãi đỗ, giá, đánh giá, ví, xe hoặc lịch sử đặt chỗ.' };
    }
    const dataAnswer = await this.answerPublicParkingDataQuestion(lastUserMessage);
    if (dataAnswer) return dataAnswer;

    if (this.isUserAccountOverviewQuestion(lastUserMessage)) {
      if (!userId) return { text: 'Vui lòng đăng nhập để mình xem tổng quan tài khoản GoPark của bạn.' };
      return this.getUserAccountOverview(userId);
    }

    // ----- XỬ LÝ CÁC INTENT CẦN DATA -----
    if (requiresData(intent) && INTENT_DB_CONFIG[intent]) {
      const config = INTENT_DB_CONFIG[intent];
      // Kiểm tra đăng nhập nếu cần
      if (config.requiresUserId && !userId) {
        return { text: 'Vui lòng đăng nhập để sử dụng tính năng này.' };
      }

      switch (intent) {
        case ChatbotIntent.FIND_NEARBY: {
          const result = await this.searchParking(
            { criteria: 'nearest', limit: 5,
              userLat: context?.userLat, userLng: context?.userLng },
            userId,
          );
          if (result.lots?.length) {
            return {
              text: result.lots[0]?.distance_km
                ? `Tìm thấy ${result.lots.length} bãi gần bạn nhất.`
                : `Đây là ${result.lots.length} bãi còn nhiều chỗ trống nhất hiện tại.`,
              action: 'list_parking',
              data: { lots: result.lots, action: 'list_parking', criteria: 'nearest' },
            };
          }
          return { text: 'Không tìm thấy bãi nào. Vui lòng thử lại.' };
        }

        case ChatbotIntent.FIND_BEST: {
          // Phân biệt: rẻ nhất → price_cheapest, phù hợp nhất → best_rating
          const msg = lastUserMessage.toLowerCase();
          const isCheapest = msg.includes('rẻ') || msg.includes('re ') || msg.includes('re nhat') || msg.includes('gia re') || msg.includes('giá rẻ') || msg.includes('cheapest');
          const criteria = isCheapest ? 'price_cheapest' : 'best_rating';
          const limit = isCheapest ? 5 : 1;
          const result = await this.searchParking({ criteria, limit }, userId);
          if (result.lots?.length) {
            if (isCheapest) {
              return {
                text: `Top ${result.lots.length} bãi giá rẻ nhất hiện có, sắp xếp theo giá/giờ tăng dần:`,
                action: 'list_parking',
                data: { lots: result.lots, action: 'list_parking', criteria: 'price_cheapest' },
              };
            }
            const top = result.lots[0];
            return {
              text: `Bãi phù hợp nhất: **${top.name}**\n\nTiêu chí:\n- Đánh giá: ${Number(top.avgRating || 0).toFixed(1)} sao (40%)\n- Chỗ trống: ${top.available_slots}/${top.total_slots} (30%)\n- Giá: ${(top.hourly_rate || 20000).toLocaleString('vi-VN')}đ/giờ (30%)`,
              action: 'list_parking',
              data: { lots: result.lots, action: 'list_parking', criteria: 'best' },
            };
          }
          return { text: 'Không tìm thấy bãi phù hợp.' };
        }

        case ChatbotIntent.CHECK_BOOKING: {
          const data = await this.getUserBookings(userId);
          if (data.error) return { text: data.error };
          const bookings = data.bookings || [];
          if (bookings.length === 0) return { text: 'Bạn chưa có đặt chỗ nào.' };
          return {
            text:
              `## Lịch sử đặt chỗ\n\n` +
              this.markdownTable(
                ['#', 'Bãi đỗ', 'Bắt đầu', 'Kết thúc', 'Trạng thái'],
                bookings.map((b: any, i: number) => [
                  i + 1,
                  b.lot_name || '-',
                  new Date(b.start_time).toLocaleString('vi-VN'),
                  new Date(b.end_time).toLocaleString('vi-VN'),
                  b.status || '-',
                ]),
              ),
          };
        }

        case ChatbotIntent.CHECK_WALLET: {
          const data = await this.getWalletBalance(userId);
          if (data.error) return { text: data.error };
          const balance = data.balance || 0;
          return {
            text:
              `## Ví GoPark\n\n` +
              this.markdownTable(['Hạng mục', 'Giá trị'], [
                ['Số dư hiện tại', `${Number(balance).toLocaleString('vi-VN')}đ`],
              ]),
          };
        }

        case ChatbotIntent.CHECK_VEHICLES: {
          const data = await this.getUserVehicles(userId);
          if (data.error) return { text: data.error };
          const vehicles = data.vehicles || [];
          if (vehicles.length === 0) return { text: 'Bạn chưa đăng ký xe nào. Vào mục "Xe của tôi" để thêm xe.' };
          return {
            text:
              `## Xe đã đăng ký\n\n` +
              this.markdownTable(
                ['Lựa chọn', 'Biển số', 'Loại xe'],
                vehicles.map((v: any, i: number) => [
                  `xe ${i + 1}`,
                  v.plate_number || '-',
                  v.type || 'Xe hơi',
                ]),
              ) +
              `\n\nKhi đặt chỗ, bạn chỉ cần trả lời \`xe 1\` hoặc \`xe 2\`.`,
          };
        }

        case ChatbotIntent.CHECK_INVOICE:
          return { text: 'Tính năng xem hóa đơn đang được phát triển. Bạn có thể xem trong trang Cá nhân.' };

        case ChatbotIntent.CANCEL_BOOKING:
          return { text: 'Vui lòng cung cấp mã đặt chỗ (ID) bạn muốn hủy.' };

        default:
          break;
      }
    }

    // ----- XỬ LÝ ĐẶT BÃI (BOOK_PARKING / BOOK_WITH_DETAILS) -----
    if (
      (intent === ChatbotIntent.BOOK_PARKING ||
        intent === ChatbotIntent.BOOK_WITH_DETAILS ||
        shouldContinueBooking) &&
      !this.isBookingMetaQuestion(lastUserMessage)
    ) {
      if (!userId) {
        return { text: 'Bạn cần đăng nhập để đặt bãi. Vui lòng đăng nhập để tiếp tục đặt chỗ.' };
      }

      // Nếu là câu hỏi hướng dẫn -> dùng Groq
      const msgLower = lastUserMessage.toLowerCase();
      if (
        msgLower.includes('cách') || msgLower.includes('như thế nào') ||
        msgLower.includes('hướng dẫn') || msgLower.includes('làm sao') ||
        msgLower.includes('bước') || msgLower.includes('quy trình') ||
        msgLower.includes('cach') || msgLower.includes('huong dan')
      ) {
        const text = await this.completeTextWithGroqThenGemini(
          [{ role: 'system', content: this.getSystemPrompt() }, ...messages.slice(-4)],
          0.7,
        );
        return { text: text || 'De dat bai: tim bai phu hop, chon thoi gian, xe, phuong thuc thanh toan, roi xac nhan dat cho.' };
      }

      return this.handleSmartBooking(lastUserMessage, userId, context, sessionPendingBooking);
    }

    // ----- FALLBACK: GỌI GROQ CHO CÁC CÂU HỎI THƯỜNG (FREE_FORM) -----
    if (
      intent === ChatbotIntent.FREE_FORM ||
      intent === ChatbotIntent.PAYMENT_GUIDE ||
      intent === ChatbotIntent.CONTACT ||
      intent === ChatbotIntent.OPENING_HOURS ||
      intent === ChatbotIntent.PROMOTION ||
      intent === ChatbotIntent.OWNER_FEATURE ||
      intent === ChatbotIntent.VIEW_PARKING_DETAIL ||
      intent === ChatbotIntent.ASK_CRITERIA
    ) {
      const allowTools = [
        ChatbotIntent.FREE_FORM,
        ChatbotIntent.VIEW_PARKING_DETAIL,
        ChatbotIntent.ASK_CRITERIA,
      ].includes(intent);
      return this.runLlmToolRagPipeline(messages, userId, context, allowTools);
    }

    // Mọi intent còn lại -> Groq xử lý thay vì fallback cứng
    const text = await this.completeTextWithGroqThenGemini(
      [{ role: 'system', content: this.getSystemPrompt() }, ...messages.slice(-6)],
      0.7,
    );
    return text ? { text } : await this.fallbackProcess(messages, userId);
  } catch (error) {
    this.logger.error('processMessage error', error);
    return await this.fallbackProcess(messages, userId);
  }
  }

  private async runLlmToolRagPipeline(
    messages: { role: string; content: string }[],
    userId?: string,
    context?: any,
    allowTools = true,
  ): Promise<{ text: string; action?: string; data?: any; redirectUrl?: string }> {
    // Pipeline câu hỏi tự do: lấy RAG context, gọi LLM, và bật function calling khi cần dữ liệu runtime.
    const lastUserMessage = messages.filter((message) => message.role === 'user').pop()?.content || '';
    const knowledgeContext = this.knowledgeService?.buildContext(lastUserMessage, 4) || '';

    if (!this.groq) {
      const knowledgeAnswer = this.knowledgeService?.answerFromKnowledge(lastUserMessage);
      if (knowledgeAnswer) return { text: knowledgeAnswer };
      const geminiText = await this.completeWithGemini(
        [{ role: 'system', content: this.getLlmToolRagSystemPrompt(knowledgeContext) }, ...messages.slice(-8)],
        0.3,
      );
      return geminiText ? { text: this.cleanChatText(geminiText) } : this.fallbackProcess(messages, userId);
    }

    const systemPrompt = this.getLlmToolRagSystemPrompt(knowledgeContext);
    const recentMessages = messages.slice(-8);
    const firstPayload: any = {
      model: this.groqModel,
      messages: [
        { role: 'system', content: systemPrompt },
        ...recentMessages,
      ] as any,
      temperature: 0.3,
    };
    if (allowTools) {
      firstPayload.tools = this.getToolsDefinition();
      firstPayload.tool_choice = 'auto';
    }
    let firstResponse: any;
    try {
      firstResponse = await this.groq.chat.completions.create(firstPayload);
    } catch (error) {
      if (this.isGroqRateLimitError(error)) {
        const geminiText = await this.completeWithGemini(firstPayload.messages, 0.3);
        if (geminiText) return { text: this.cleanChatText(geminiText) };
      }
      if (allowTools) {
        this.logger.warn('LLM tool calling failed, retrying without tools');
        return this.runLlmToolRagPipeline(messages, userId, context, false);
      }
      throw error;
    }

    const assistantMessage = firstResponse.choices[0]?.message;
    const toolCalls = assistantMessage?.tool_calls || [];
    if (!toolCalls.length) {
      return {
        text: this.cleanChatText(
          assistantMessage?.content || 'Minh chua co du lieu phu hop de tra loi cau nay.',
        ),
      };
    }

    const toolMessages: any[] = [];
    const toolResults: any[] = [];
    for (const toolCall of toolCalls) {
      const result = await this.executeTool(toolCall, userId, context);
      toolResults.push({ name: toolCall.function?.name, result });
      toolMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolCall.function?.name,
        content: JSON.stringify(this.compactToolResult(result)),
      });
    }

    const finalMessages = [
        { role: 'system', content: systemPrompt },
        ...recentMessages,
        assistantMessage,
        ...toolMessages,
      ] as any;
    let finalResponse: any;
    try {
      finalResponse = await this.groq.chat.completions.create({
      model: this.groqModel,
      messages: finalMessages,
      temperature: 0.25,
      } as any);
    } catch (error) {
      if (this.isGroqRateLimitError(error)) {
        const geminiText = await this.completeWithGemini(finalMessages, 0.25);
        if (geminiText) {
          finalResponse = { choices: [{ message: { content: geminiText } }] };
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
    const finalText = this.cleanChatText(
      finalResponse.choices[0]?.message?.content ||
        assistantMessage?.content ||
        'Minh da lay du lieu he thong nhung chua tong hop duoc cau tra loi.',
    );

    const redirectResult = toolResults.find((item) => item.result?.action === 'redirect')?.result;
    if (redirectResult) {
      return {
        text: finalText || redirectResult.message,
        action: 'redirect',
        redirectUrl: redirectResult.redirectUrl,
        data: redirectResult,
      };
    }

    const listResult = toolResults.find((item) => item.result?.action === 'list_parking')?.result;
    if (listResult) {
      return {
        text: finalText,
        action: 'list_parking',
        data: {
          lots: listResult.lots || [],
          action: 'list_parking',
          criteria: listResult.criteria,
        },
      };
    }

    return { text: finalText, data: { toolResults } };
  }

  private compactToolResult(result: any): any {
    if (!result || typeof result !== 'object') return result;
    if (Array.isArray(result.lots)) {
      return {
        ...result,
        lots: result.lots.slice(0, 5).map((lot: any) => ({
          id: lot.id,
          name: lot.name,
          address: lot.address,
          available_slots: lot.available_slots,
          total_slots: lot.total_slots,
          hourly_rate: lot.hourly_rate,
          avgRating: lot.avgRating,
          distance_km: lot.distance_km,
        })),
      };
    }
    if (Array.isArray(result.bookings)) return { bookings: result.bookings.slice(0, 5) };
    if (Array.isArray(result.vehicles)) return { vehicles: result.vehicles.slice(0, 5) };
    return result;
  }

  private isGroqRateLimitError(error: any): boolean {
    const status = error?.status || error?.response?.status;
    const code = error?.error?.error?.code || error?.error?.code || error?.code;
    const message = String(error?.error?.error?.message || error?.message || '');
    return status === 429 || code === 'rate_limit_exceeded' || message.toLowerCase().includes('rate limit');
  }

  private async completeTextWithGroqThenGemini(
    messages: Array<{ role: string; content: string }>,
    temperature = 0.5,
  ): Promise<string | null> {
    if (this.groq) {
      try {
        const response = await this.groq.chat.completions.create({
          model: this.groqModel,
          messages: messages as any,
          temperature,
        });
        return response.choices[0]?.message?.content || null;
      } catch (error) {
        if (!this.isGroqRateLimitError(error)) throw error;
        this.logger.warn('Groq rate limit reached, falling back to Gemini');
      }
    }

    return this.completeWithGemini(messages, temperature);
  }

  private async completeWithGemini(
    messages: Array<{ role: string; content?: string; name?: string }>,
    temperature = 0.5,
  ): Promise<string | null> {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    const systemParts: string[] = [];
    const contents = messages
      .map((message) => {
        const content =
          typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content ?? '');
        if (!content.trim()) return null;
        if (message.role === 'system') {
          systemParts.push(content);
          return null;
        }
        return {
          role: message.role === 'assistant' || message.role === 'tool' ? 'model' : 'user',
          parts: [{ text: message.role === 'tool' ? `Kết quả tool ${message.name || ''}: ${content}` : content }],
        };
      })
      .filter(Boolean);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: systemParts.length
            ? { parts: [{ text: systemParts.join('\n\n') }] }
            : undefined,
          contents,
          generationConfig: {
            temperature,
            maxOutputTokens: 700,
          },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.warn(`Gemini fallback failed: ${response.status} ${errorText.slice(0, 180)}`);
      return null;
    }

    const data = await response.json();
    return data?.candidates?.[0]?.content?.parts
      ?.map((part: any) => part.text || '')
      .join('')
      .trim() || null;
  }

  private getLlmToolRagSystemPrompt(knowledgeContext: string): string {
    return [
      this.getSystemPrompt(),
      '',
      'PIPELINE BAT BUOC:',
      '- Neu cau hoi can du lieu thuc te cua he thong, phai goi tool/function truoc khi tra loi.',
      '- Chi dung RAG context de huong dan chinh sach, cach dung, luong thao tac; khong bien RAG thanh so lieu runtime.',
      '- Sau khi tool tra ve du lieu, tom tat ngan gon, uu tien bang markdown nho neu co nhieu dong.',
      '- Khong hien ID noi bo neu nguoi dung khong can thao tac bang ID.',
      '- Neu thieu dang nhap hoac thieu du lieu, noi ro can bo sung gi.',
      knowledgeContext ? `\nRAG CONTEXT LIEN QUAN:\n${knowledgeContext}` : '',
    ].join('\n');
  }

  private normalizeText(value: string): string {
    return (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\u0111/g, 'd')
      .replace(/[^a-z0-9:\-\.\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isBookingCancelMessage(message: string): boolean {
    const text = this.normalizeText(message);
    return /\b(huy|thoat|bo qua|dung lai|khong dat|cancel|stop)\b/.test(text);
  }

  private isBookingContinuationMessage(message: string, pending: any = {}): boolean {
    const text = this.normalizeText(message);
    if (!text) return false;

    if (this.isBookingMetaQuestion(message)) return false;

    const asksDifferentQuestion =
      /\b(top|danh gia|mac nhat|dat nhat|re nhat|gia cao|gia re|nhieu cho|con trong|lam duoc gi|giup duoc gi|cong viec|chuc nang|ban la ai|cach dung|he thong|ngoai dat bai|phan van|nen gui|tu van|loi khuyen|kinh nghiem|the nao|nhu the nao)\b/.test(text);
    if (asksDifferentQuestion) return false;

    if (/^(bai|xe|thanh toan|payment|tra tien)\s*\d+$/.test(text)) return true;
    if (/^(vi tri|cho|slot|o)\s*[\w-]+$/.test(text)) return true;
    if (/\b(doi|sua|chon lai|chinh lai)\b/.test(text) && /\b(bai|thoi gian|gio|xe|vi tri|cho|slot|thanh toan)\b/.test(text)) return true;
    if (this.parsePaymentMethod(message)) return true;
    if (this.parseBookingTimes(message).startTime) return true;
    if (/\b(ngay mai|hom nay|tu\s*\d{1,2}|luc\s*\d{1,2}|\d{1,2}h|den\s*\d{1,2})\b/.test(text)) return true;
    if (/\b(xe|bien so|oto|o to|car|motor|moto)\b/.test(text)) return true;
    if (!pending?.parkingLotId && /\b(bai|bai do|parking|do xe)\b/.test(text)) return true;
    if (pending?.parkingLotId && pending?.startTime && pending?.endTime && /\b(vi tri|cho|slot|o|con trong)\b/.test(text)) return true;

    return false;
  }

  private isBookingMetaQuestion(message: string): boolean {
    const text = this.normalizeText(message);
    return (
      text.includes('ngoai dat bai') ||
      (text.includes('dat bai') && /\b(lam duoc gi|giup duoc gi|cong viec|chuc nang|co the lam|cach dung|he thong)\b/.test(text))
    );
  }

  private isClearlyOffTopic(message: string): boolean {
    const text = this.normalizeText(message);
    if (!text) return false;
    const domainWords =
      /\b(gopark|bai|bai do|parking|do xe|cho do|dat cho|dat bai|booking|slot|vi tri|xe|bien so|vi|wallet|thanh toan|vnpay|hoa don|invoice|khuyen mai|support|ho tro|tai khoan|user|owner|admin|doanh thu|request|yeu cau)\b/;
    if (domainWords.test(text)) return false;

    return /\b(code|coding|lap trinh|html|css|javascript|typescript|python|hello world|viet code|tao code|source code|script|component|react|vue|angular|debug code|nau an|mon an|cong thuc|bong da|the thao|thoi tiet|xem phim|phim|am nhac|bai hat|game|toan lop|giai bai tap|tinh yeu|tu vi|boi bai|du lich nuoc ngoai)\b/.test(text);
  }

  private getOffTopicResponse(role: 'user' | 'owner' | 'admin'): string {
    const roleHelp = {
      user: ['`top 5 bãi còn nhiều chỗ trống`', '`đặt bãi`', '`ví của tôi còn bao nhiêu`'],
      owner: ['`dashboard hôm nay`', '`doanh thu tháng này`', '`gợi ý tăng doanh thu`'],
      admin: ['`tổng quan hệ thống`', '`cảnh báo hệ thống`', '`yêu cầu chờ duyệt`'],
    }[role];
    return [
      'Xin lỗi, mình chỉ hỗ trợ các câu hỏi liên quan đến GoPark và bãi đỗ xe.',
      'Mình không thể viết code/HTML hoặc trả lời các chủ đề ngoài phạm vi bãi đỗ.',
      `Bạn có thể hỏi: ${roleHelp.join(', ')}.`,
    ].join('\n');
  }

  private isUserAccountOverviewQuestion(message: string): boolean {
    const text = this.normalizeText(message);
    return /\b(tong quan tai khoan|tai khoan cua toi|thong tin cua toi|tom tat tai khoan|dashboard cua toi)\b/.test(text);
  }

  private markdownTable(
    headers: string[],
    rows: Array<Array<string | number>>,
  ): string {
    if (!rows.length) return '_Khong co du lieu phu hop._';
    const header = `| ${headers.map((cell) => this.cleanDisplayText(cell)).join(' | ')} |`;
    const divider = `| ${headers.map(() => '---').join(' | ')} |`;
    const body = rows.map((row) => `| ${row.map((cell) => this.cleanDisplayText(cell)).join(' | ')} |`);
    return [header, divider, ...body].join('\n');
  }
  private extractLimit(message: string, fallback = 5): number {
    const match = this.normalizeText(message).match(/\btop\s*(\d{1,2})\b|\b(\d{1,2})\s*(bai|ket qua|parking)\b/);
    const value = Number(match?.[1] || match?.[2] || fallback);
    return Math.min(Math.max(value || fallback, 1), 20);
  }

  private formatParkingRows(lots: any[]): Array<Array<string | number>> {
    return lots.map((lot: any, index: number) => [
      index + 1,
      lot.name || 'Bãi đỗ',
      lot.address || '-',
      `${lot.available_slots ?? '-'}/${lot.total_slots ?? '-'}`,
      `${Number(lot.hourly_rate || 0).toLocaleString('vi-VN')} VND`,
      Number(lot.avgRating || 0).toFixed(1),
    ]);
  }

  private cleanDisplayText(value: any, fallback = '-'): string {
    const text = Array.from(String(value ?? ''))
      .filter((char) => {
        const code = char.charCodeAt(0);
        return code !== 0xfffd && !(code <= 0x1f) && !(code >= 0x7f && code <= 0x9f);
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    return text || fallback;
  }

  private cleanChatText(value: any): string {
    return Array.from(String(value ?? ''))
      .filter((char) => {
        const code = char.charCodeAt(0);
        if (code === 0x0a || code === 0x0d || code === 0x09) return true;
        return code !== 0xfffd && !(code <= 0x1f) && !(code >= 0x7f && code <= 0x9f);
      })
      .join('');
  }

  private async answerPublicParkingDataQuestion(message: string): Promise<any | null> {
    // Trả lời ranking bãi bằng DB trực tiếp, không dùng LLM để tránh bịa số liệu.
    const text = this.normalizeText(message);
    const asksParking =
      text.includes('bai') ||
      text.includes('do xe') ||
      text.includes('parking') ||
      text.includes('cho trong') ||
      text.includes('danh gia') ||
      text.includes('gia') ||
      text.includes('trong');
    if (!asksParking) return null;

    const isHighestRated =
      (text.includes('danh gia') && (text.includes('cao') || text.includes('tot') || text.includes('top'))) ||
      text.includes('rating cao') ||
      text.includes('duoc danh gia cao');
    const isMostExpensive =
      text.includes('mac nhat') ||
      text.includes('dat nhat') ||
      text.includes('gia cao') ||
      text.includes('expensive');
    const isCheapest =
      text.includes('re nhat') ||
      text.includes('gia re') ||
      text.includes('cheapest');
    const isMostAvailable =
      text.includes('nhieu cho') ||
      text.includes('con trong') ||
      text.includes('dang trong') ||
      text.includes('bai trong') ||
      text.includes('cho trong nhieu') ||
      text.includes('trong nhat') ||
      /\b(trong|available|empty|vacant)\b/.test(text);

    if (!isHighestRated && !isMostExpensive && !isCheapest && !isMostAvailable) return null;

    const limit = this.extractLimit(message, text.includes('top') ? 10 : 5);
    const lots = (await this.getParkingLotsRaw()).filter((lot: any) => Number(lot.available_slots || 0) >= 0);
    if (!lots.length) return { text: 'Hien chua co du lieu bai do de hien thi.' };

    let title = '';
    let criteria = 'parking_data';
    if (isHighestRated) {
      title = `Top ${limit} bai do duoc danh gia cao nhat`;
      criteria = 'highest_rating';
      lots.sort((a: any, b: any) => Number(b.avgRating || 0) - Number(a.avgRating || 0));
    } else if (isMostExpensive) {
      title = `Top ${limit} bai do co gia cao nhat`;
      criteria = 'highest_price';
      lots.sort((a: any, b: any) => Number(b.hourly_rate || 0) - Number(a.hourly_rate || 0));
    } else if (isCheapest) {
      title = `Top ${limit} bai do gia re nhat`;
      criteria = 'price_cheapest';
      lots.sort((a: any, b: any) => Number(a.hourly_rate || 0) - Number(b.hourly_rate || 0));
    } else {
      title = `Top ${limit} bai do con nhieu cho trong nhat`;
      criteria = 'most_available';
      lots.sort((a: any, b: any) => Number(b.available_slots || 0) - Number(a.available_slots || 0));
    }

    const selected = lots.slice(0, limit).map((lot: any, index: number) => ({
      id: lot.id,
      name: lot.name || 'Bãi đỗ',
      address: lot.address || '-',
      total_slots: lot.total_slots,
      available_slots: lot.available_slots,
      hourly_rate: lot.hourly_rate,
      avgRating: lot.avgRating,
      status: lot.status,
    }));
    return {
      text: this.cleanChatText(
        `## ${title}\n\n` +
        this.markdownTable(['#', 'Bai do', 'Dia chi', 'Cho trong', 'Gia/gio', 'Danh gia'], this.formatParkingRows(selected)),
      ),
      action: 'list_parking',
      data: { lots: selected, action: 'list_parking', criteria },
    };
  }

  private parseBookingTimes(message: string): { startTime?: string; endTime?: string } {
    const text = this.normalizeText(message);
    const isOnlyNumberedChoice =
      /^(bai|xe|thanh toan|payment|tra tien|vi tri|cho|slot|o)\s*[\w-]+$/.test(text);
    if (isOnlyNumberedChoice) return {};

    const baseDate = this.getVietnamDateString(text.includes('ngay mai') || text.includes('tomorrow') ? 1 : 0);

    const fromTo = text.match(/(?:tu|luc)?\s*(\d{1,2})(?:\s*h\s*|:)?(\d{2})?\s*(?:den|toi|-)\s*(\d{1,2})(?:\s*h\s*|:)?(\d{2})?/);
    if (fromTo) {
      const startMinutes = Number(fromTo[1]) * 60 + Number(fromTo[2] || 0);
      const endMinutes = Number(fromTo[3]) * 60 + Number(fromTo[4] || 0);
      const endDate = endMinutes <= startMinutes ? this.addDaysToDateString(baseDate, 1) : baseDate;
      return {
        startTime: this.toLocalInputDateTime(baseDate, startMinutes),
        endTime: this.toLocalInputDateTime(endDate, endMinutes),
      };
    }

    const duration = text.match(/(?:trong|dat)\s*(\d{1,2})\s*(?:gio|tieng|h)/);
    const singleTime = text.match(/(?:luc|tu)?\s*(\d{1,2})(?:\s*h\s*|:)?(\d{2})?/);
    if (singleTime) {
      const startMinutes = Number(singleTime[1]) * 60 + Number(singleTime[2] || 0);
      const endMinutesRaw = startMinutes + Number(duration?.[1] || 1) * 60;
      const endDate = endMinutesRaw >= 24 * 60 ? this.addDaysToDateString(baseDate, 1) : baseDate;
      return {
        startTime: this.toLocalInputDateTime(baseDate, startMinutes),
        endTime: this.toLocalInputDateTime(endDate, endMinutesRaw % (24 * 60)),
      };
    }

    return {};
  }

  private getVietnamDateString(addDays = 0): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const year = Number(parts.find((part) => part.type === 'year')?.value);
    const month = Number(parts.find((part) => part.type === 'month')?.value);
    const day = Number(parts.find((part) => part.type === 'day')?.value);
    const date = new Date(Date.UTC(year, month - 1, day + addDays));
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }

  private addDaysToDateString(dateText: string, addDays: number): string {
    const [year, month, day] = dateText.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + addDays));
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }

  private toLocalInputDateTime(dateText: string, minutes: number): string {
    const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${dateText}T${pad(Math.floor(normalized / 60))}:${pad(normalized % 60)}`;
  }

  private parseLocalInputAsVietnamDate(value: string): Date {
    const normalized = value.includes('+') || value.endsWith('Z') ? value : `${value.length === 16 ? `${value}:00` : value}+07:00`;
    return new Date(normalized);
  }

  private parsePaymentMethod(message: string): string | undefined {
    const text = this.normalizeText(message);
    const indexed = text.match(/(?:thanh toan|tra tien|payment)\s*(\d+)/);
    if (indexed) {
      const methods = ['vnpay', 'wallet', 'cash'];
      return methods[Number(indexed[1]) - 1];
    }
    if (text.includes('vi') || text.includes('wallet')) return 'wallet';
    if (text.includes('tien mat') || text.includes('cash')) return 'cash';
    if (text.includes('vnpay') || text.includes('online') || text.includes('the')) return 'vnpay';
    return undefined;
  }

  private resolveVehicle(message: string, vehicles: any[], pending: any): any {
    const text = this.normalizeText(message);
    const indexed = text.match(/\bxe\s*(\d+)\b/);
    if (indexed) {
      const vehicle = vehicles[Number(indexed[1]) - 1];
      if (vehicle) return vehicle;
    }

    const compactMessage = text.replace(/\s/g, '');
    return vehicles.find((vehicle: any) => {
      const plate = this.normalizeText(vehicle.plate_number || '').replace(/\s/g, '');
      return plate && compactMessage.includes(plate);
    }) || vehicles.find((vehicle: any) => String(vehicle.id) === String(pending.vehicleId));
  }

  private applyBookingCorrections(message: string, pending: any): any {
    const text = this.normalizeText(message);
    const next = { ...pending };
    const wantsChange = /\b(doi|sua|chon lai|chinh lai|khac)\b/.test(text);
    if (!wantsChange) return next;

    if (/\b(bai|bai do|parking)\b/.test(text)) {
      delete next.parkingLotId;
      delete next.parkingLotName;
      delete next.slotId;
      delete next.slotLabel;
      delete next.slotOptions;
    }
    if (/\b(thoi gian|gio|ngay|luc|tu|den)\b/.test(text)) {
      delete next.startTime;
      delete next.endTime;
      delete next.slotId;
      delete next.slotLabel;
      delete next.slotOptions;
    }
    if (/\b(vi tri|cho|slot|o)\b/.test(text)) {
      delete next.slotId;
      delete next.slotLabel;
    }
    if (/\b(xe|bien so)\b/.test(text)) {
      delete next.vehicleId;
      delete next.vehiclePlate;
    }
    if (/\b(thanh toan|payment|tra tien)\b/.test(text)) {
      delete next.paymentMethod;
    }
    return next;
  }

  private resolveSlot(message: string, slotOptions: any[] = [], pending: any = {}): any {
    const text = this.normalizeText(message);
    const indexed = text.match(/\b(?:vi tri|cho|slot|o)\s*(\d+)\b/);
    if (indexed) {
      const slot = slotOptions[Number(indexed[1]) - 1];
      if (slot?.id) return slot;
    }

    const directCode = text.match(/\b(?:slot|cho|vi tri|o)\s*([a-z]{1,4}\s*[-]?\s*\d{1,4})\b/);
    const compactQuery = (directCode?.[1] || text).replace(/\s|-/g, '');
    const byCode = slotOptions.find((slot: any) =>
      this.normalizeText(slot.code || '').replace(/\s|-/g, '') === compactQuery ||
      this.normalizeText(slot.label || '').replace(/\s|-/g, '').includes(compactQuery),
    );
    return byCode || slotOptions.find((slot: any) => String(slot.id) === String(pending.slotId));
  }

  private isSlotAvailable(slot: any): boolean {
    if (!slot) return false;
    if (slot.is_booked === true || slot.is_booked === 'true' || slot.is_booked === 1 || slot.is_booked === '1') {
      return false;
    }
    return this.normalizeText(slot.status || 'AVAILABLE') === 'available';
  }

  private slotStatusLabel(slot: any): string {
    return this.isSlotAvailable(slot) ? 'Trống' : 'Đã đặt';
  }

  private formatSlotLabel(slot: any): string {
    const floor = slot.floor_name || slot.floor_number || '-';
    const zone = slot.zone_name || '-';
    return `${floor}-${zone}-${slot.code}`;
  }

  private formatSlotOptions(slots: any[]): string {
    if (!slots.length) {
      return '\n\nHien khong co vi tri trong phu hop voi khung gio nay. Ban co the doi gio hoac chon bai khac.';
    }
    return `\n\n${this.markdownTable(
      ['Lựa chọn', 'Tầng', 'Khu', 'Vị trí', 'Trạng thái'],
      slots.slice(0, 12).map((slot: any, index: number) => [
        `Vị trí ${index + 1}`,
        slot.floor_name || slot.floor_number || '-',
        slot.zone_name || '-',
        slot.code || '-',
        this.slotStatusLabel(slot),
      ]),
    )}` +
      `\n\nBạn có thể chọn vị trí còn **Trống**, ví dụ: "vị trí 1" hoặc "slot A1". Nếu vị trí đã đặt, mình sẽ yêu cầu bạn chọn vị trí khác.`;
  }

  private async getSlotsForBooking(parkingLotId: string, startTime: string, endTime: string): Promise<any[]> {
    return this.dataSource.query(
      `SELECT ps.id,
              ps.code,
              ps.status,
              pz.zone_name,
              pf.floor_name,
              pf.floor_number,
              CASE
                WHEN ps.status <> 'AVAILABLE' OR EXISTS (
                  SELECT 1
                  FROM bookings b
                  WHERE b.slot_id = ps.id
                    AND b.status IN ('PENDING', 'CONFIRMED', 'ONGOING')
                    AND b.start_time < $3
                    AND b.end_time > $2
                )
                THEN true
                ELSE false
              END AS is_booked
       FROM parking_slots ps
       JOIN parking_zones pz ON pz.id = ps.parking_zone_id
       JOIN parking_floors pf ON pf.id = pz.parking_floor_id
       WHERE pf.parking_lot_id = $1
       ORDER BY is_booked ASC, pf.floor_number ASC, pz.zone_name ASC, ps.code ASC
       LIMIT 12`,
      [parkingLotId, this.parseLocalInputAsVietnamDate(startTime), this.parseLocalInputAsVietnamDate(endTime)],
    );
  }

  private async validateParkingLotOperatingTime(parkingLotId: string, startTime: string, endTime: string): Promise<string | null> {
    const rows = await this.dataSource.query(
      `SELECT open_time, close_time FROM parking_lots WHERE id = $1 LIMIT 1`,
      [parkingLotId],
    );
    const lot = rows[0];
    if (!lot?.open_time || !lot?.close_time) return null;

    const openMinutes = this.getMinutesFromDbTime(lot.open_time);
    const closeMinutes = this.getMinutesFromDbTime(lot.close_time);
    const startMinutes = this.getMinutesFromLocalInput(startTime);
    const endMinutes = this.getMinutesFromLocalInput(endTime);
    const format = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    const inRange = (mins: number) =>
      openMinutes <= closeMinutes
        ? mins >= openMinutes && mins <= closeMinutes
        : mins >= openMinutes || mins <= closeMinutes;

    if (!inRange(startMinutes) || !inRange(endMinutes)) {
      return `Bai nay chi hoat dong tu ${format(openMinutes)} den ${format(closeMinutes)}. Ban hay chon lai thoi gian nam trong gio mo cua.`;
    }
    return null;
  }

  private getMinutesFromLocalInput(value: string): number {
    const time = value.split('T')[1] || value;
    const [hour, minute] = time.split(':').map(Number);
    return (hour || 0) * 60 + (minute || 0);
  }

  private getMinutesFromDbTime(value: string | Date): number {
    if (value instanceof Date) return value.getHours() * 60 + value.getMinutes();
    const match = String(value).match(/T(\d{1,2}):(\d{2})|^(\d{1,2}):(\d{2})/);
    if (match) {
      return Number(match[1] || match[3]) * 60 + Number(match[2] || match[4]);
    }
    const date = new Date(value);
    return date.getHours() * 60 + date.getMinutes();
  }

  private formatVehicleOptions(vehicles: any[]): string {
    if (!vehicles.length) {
      return 'Bạn chưa có xe trong hệ thống, hãy thêm xe trước khi đặt.';
    }

    return `\n\n| Lựa chọn | Biển số | Loại xe |\n|---|---|---|\n` +
      vehicles.map((v: any, index: number) => {
        return `| Xe ${index + 1} | ${v.plate_number} | ${v.type || 'Xe hơi'} |`;
      }).join('\n') + `\n\nBạn chỉ cần chọn một xe, ví dụ: "xe 1".`;
  }

  private formatPaymentOptions(): string {
    return `\n\n| Lựa chọn | Phương thức |\n|---|---|\n| Thanh toán 1 | VNPAY |\n| Thanh toán 2 | Ví GoPark |\n| Thanh toán 3 | Tiền mặt |\n\nNếu bạn không chọn, mình sẽ để mặc định là VNPAY.`;
  }

  private async getDynamicTimeSuggestions(parkingLotId?: string): Promise<string[]> {
    let openMinutes = 7 * 60;
    let closeMinutes = 22 * 60;

    if (parkingLotId) {
      const rows = await this.dataSource.query(
        `SELECT open_time, close_time FROM parking_lots WHERE id = $1 LIMIT 1`,
        [parkingLotId],
      );
      const lot = rows[0];
      if (lot?.open_time && lot?.close_time) {
        openMinutes = this.getMinutesFromDbTime(lot.open_time);
        closeMinutes = this.getMinutesFromDbTime(lot.close_time);
      }
    }

    const endBoundary = closeMinutes <= openMinutes ? 24 * 60 : closeMinutes;
    const nowParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const nowMinutes =
      Number(nowParts.find((part) => part.type === 'hour')?.value || 0) * 60 +
      Number(nowParts.find((part) => part.type === 'minute')?.value || 0);
    const roundedNow = Math.ceil((nowMinutes + 30) / 30) * 30;
    const todayStart = Math.max(openMinutes, Math.min(roundedNow, endBoundary - 60));
    const tomorrowStart = Math.min(Math.max(openMinutes + 30, openMinutes), endBoundary - 90);
    const duration = (start: number, preferred = 120) => Math.max(60, Math.min(preferred, endBoundary - start));
    const format = (minutes: number) => {
      const normalized = Math.max(0, Math.min(minutes, 24 * 60 - 1));
      const hour = Math.floor(normalized / 60);
      const minute = normalized % 60;
      return minute ? `${hour}h${String(minute).padStart(2, '0')}` : `${hour}h`;
    };

    return [
      `hom nay tu ${format(todayStart)} den ${format(todayStart + duration(todayStart, 120))}`,
      `ngay mai tu ${format(tomorrowStart)} den ${format(tomorrowStart + duration(tomorrowStart, 90))}`,
      `ngay mai tu ${format(openMinutes)} den ${format(openMinutes + duration(openMinutes, 120))}`,
    ];
  }

  private formatTimeExamples(times: string[]): string {
    return `\n\n**Vi du nhap thoi gian:**\n- "${times[0]}"\n- "${times[1]}"\n- "${times[2]}"`;
  }

  private formatParkingLotOptions(lots: any[]): string {
    if (!lots.length) return 'Hien chua co bai do nao de goi y.';
    return `\n\n| Lua chon | Ten bai do | Dia chi | Cho trong |\n|---|---|---|---|\n` +
      lots.slice(0, 5).map((lot: any, index: number) => {
        const slots = typeof lot.available_slots === 'number' ? lot.available_slots : '-';
        return `| Bai ${index + 1} | ${lot.name || 'Bãi đỗ'} | ${lot.address || '-'} | ${slots} |`;
      }).join('\n') + `\n\nBan chi can chon mot bai, vi du: "bai 1".`;
  }

  private async resolveParkingLot(message: string, pending: any): Promise<any> {
    const text = this.normalizeText(message);
    const indexed = text.match(/\bbai\s*(\d+)\b/);
    if (indexed && Array.isArray(pending.parkingLotOptions)) {
      const lot = pending.parkingLotOptions[Number(indexed[1]) - 1];
      if (lot?.id) return lot;
    }

    if (pending.parkingLotId) {
      const lots = await this.getParkingLotsRaw();
      const byId = lots.find((lot: any) => String(lot.id) === String(pending.parkingLotId));
      if (byId) return byId;
    }

    const lots = await this.getParkingLotsRaw();
    const explicitName = extractParkingName(message);
    let query = this.normalizeText(explicitName || message)
      .replace(/\b(toi|muon|dat|bai|bai do|cho|giup|tai|o|xe|luc|tu|den|ngay mai|hom nay)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!query) return undefined;

    const ranked = lots
      .map((lot: any) => {
        const name = this.normalizeText(lot.name);
        const address = this.normalizeText(lot.address || '');
        const score =
          name.includes(query) || query.includes(name)
            ? 1
            : query.split(' ').filter((part) => part.length > 1 && (name.includes(part) || address.includes(part))).length / Math.max(query.split(' ').length, 1);
        return { lot, score };
      })
      .sort((a, b) => b.score - a.score);

    return ranked[0]?.score >= 0.35 ? ranked[0].lot : undefined;
  }

  private async handleSmartBooking(
    message: string,
    userId: string,
    context?: any,
    sessionPendingBooking?: any,
  ): Promise<{ text: string; action?: string; data?: any; redirectUrl?: string }> {
    // Gom thông tin đặt bãi nhiều bước: bãi, giờ, slot, xe và phương thức thanh toán.
    const pending = this.applyBookingCorrections(message, {
      ...(sessionPendingBooking || {}),
      ...(context?.pendingBooking || {}),
    });
    const vehicles = (await this.getUserVehicles(userId)).vehicles || [];
    const parkingSuggestions = (await this.getParkingLotsRaw())
      .filter((lot: any) => Number(lot.available_slots || 0) > 0)
      .slice(0, 5);
    const pendingWithSuggestions = {
      ...pending,
      parkingLotOptions: pending.parkingLotOptions || parkingSuggestions,
    };
    const lot = await this.resolveParkingLot(message, pendingWithSuggestions);
    const vehicle = this.resolveVehicle(message, vehicles, pending);
    const times = this.parseBookingTimes(message);
    const paymentMethod = this.parsePaymentMethod(message) || pending.paymentMethod || 'vnpay';
    const parkingLotId = lot?.id ? String(lot.id) : pending.parkingLotId;
    const startTime = times.startTime || pending.startTime;
    const endTime = times.endTime || pending.endTime;
    const timeError = parkingLotId && startTime && endTime
      ? await this.validateParkingLotOperatingTime(parkingLotId, startTime, endTime)
      : null;
    const timeSuggestions = await this.getDynamicTimeSuggestions(parkingLotId);
    const slotOptions = parkingLotId && startTime && endTime && !timeError
      ? await this.getSlotsForBooking(parkingLotId, startTime, endTime)
      : [];
    const selectedSlot = this.resolveSlot(message, slotOptions, pending);
    const selectedSlotUnavailable = selectedSlot && !this.isSlotAvailable(selectedSlot);
    const keepPendingSlot = pending.slotId && slotOptions.some((slot: any) =>
      String(slot.id) === String(pending.slotId) && this.isSlotAvailable(slot),
    );

    const nextPending = {
      ...pending,
      parkingLotId,
      parkingLotName: lot?.name || pending.parkingLotName || 'Bãi đỗ',
      vehicleId: vehicle?.id ? String(vehicle.id) : pending.vehicleId,
      vehiclePlate: vehicle?.plate_number || pending.vehiclePlate,
      startTime: timeError ? undefined : startTime,
      endTime: timeError ? undefined : endTime,
      slotId: selectedSlot?.id && !selectedSlotUnavailable ? String(selectedSlot.id) : keepPendingSlot ? String(pending.slotId) : undefined,
      slotLabel: selectedSlot && !selectedSlotUnavailable ? this.formatSlotLabel(selectedSlot) : keepPendingSlot ? pending.slotLabel : undefined,
      slotOptions: slotOptions.map((slot: any, index: number) => ({
        id: slot.id,
        label: `vi tri ${index + 1}`,
        code: slot.code,
        floor: slot.floor_name || slot.floor_number || '-',
        zone: slot.zone_name || '-',
        status: this.slotStatusLabel(slot),
        available: this.isSlotAvailable(slot),
      })),
      paymentMethod,
      parkingLotOptions: parkingSuggestions.map((suggestion: any, index: number) => ({
        id: suggestion.id,
        name: suggestion.name || 'Bãi đỗ',
        address: suggestion.address || '-',
        available_slots: suggestion.available_slots,
      })),
    };

    const missing: string[] = [];
    if (!nextPending.parkingLotId) missing.push('ten bai do');
    if (!nextPending.startTime || !nextPending.endTime) missing.push('thoi gian vao/ra');
    if (nextPending.parkingLotId && nextPending.startTime && nextPending.endTime && !nextPending.slotId) missing.push('vi tri do');
    if (!nextPending.vehiclePlate) missing.push('xe hoac bien so');

    if (missing.length) {
      this.stateService.updateStep(userId, 'awaiting_booking_details', { pendingBooking: nextPending });
      const nextField = missing[0];
      const bookingStatus = this.markdownTable(['Thong tin', 'Trang thai'], [
        ['Bai do', nextPending.parkingLotName ? this.cleanDisplayText(nextPending.parkingLotName) : 'Can chon'],
        ['Thoi gian', nextPending.startTime && nextPending.endTime ? `${nextPending.startTime} - ${nextPending.endTime}` : 'Can nhap'],
        ['Vi tri do', nextPending.slotLabel || 'Can chon'],
        ['Xe', nextPending.vehiclePlate || 'Can chon'],
        ['Thanh toan', nextPending.paymentMethod?.toUpperCase() || 'VNPAY'],
      ]);
      const nextHint =
        nextField === 'ten bai do'
          ? this.formatParkingLotOptions(parkingSuggestions)
          : nextField === 'thoi gian vao/ra'
            ? `${timeError ? `\n\n${timeError}` : ''}${this.formatTimeExamples(timeSuggestions)}`
            : nextField === 'vi tri do'
              ? this.formatSlotOptions(slotOptions)
            : nextField === 'xe hoac bien so'
              ? this.formatVehicleOptions(vehicles)
              : this.formatPaymentOptions();
      const slotWarning = selectedSlotUnavailable
        ? `\n\nVị trí **${this.cleanDisplayText(selectedSlot.code || this.formatSlotLabel(selectedSlot))}** đã có người đặt trong khung giờ này. Bạn vui lòng chọn vị trí khác còn Trống.`
        : '';
      const nextQuestion =
        nextField === 'ten bai do'
          ? 'Ban muon dat o bai nao?'
          : nextField === 'thoi gian vao/ra'
            ? 'Ban muon gui xe luc nao va lay xe luc nao?'
            : nextField === 'vi tri do'
              ? 'Ban muon chon vi tri do nao?'
            : nextField === 'xe hoac bien so'
              ? 'Ban chon xe nao de dat cho?'
              : 'Ban muon thanh toan bang phuong thuc nao?';
      return {
        text: this.cleanChatText(`Minh da ghi nhan ${nextPending.parkingLotName ? `bai **${this.cleanDisplayText(nextPending.parkingLotName)}**` : 'yeu cau dat cho'}.\n\n${bookingStatus}${slotWarning}\n\n**${nextQuestion}**${nextHint}`),
        action: 'collect_booking',
        data: {
          missing,
          nextField,
          pendingBooking: nextPending,
          suggestions: {
            parkingLots: nextPending.parkingLotOptions,
            vehicles: vehicles.map((vehicle: any, index: number) => ({
              label: `xe ${index + 1}`,
              plateNumber: vehicle.plate_number,
              type: vehicle.type,
            })),
            slots: nextPending.slotOptions,
            payments: [
              { label: 'thanh toan 1', value: 'vnpay' },
              { label: 'thanh toan 2', value: 'wallet' },
              { label: 'thanh toan 3', value: 'cash' },
            ],
            timeExamples: timeSuggestions,
          },
        },
      };
    }

    const params = new URLSearchParams();
    params.set('start', String(nextPending.startTime));
    params.set('end', String(nextPending.endTime));
    params.set('vehicle', String(nextPending.vehiclePlate));
    params.set('payment', String(nextPending.paymentMethod));
    params.set('slot', String(nextPending.slotId));
    this.stateService.deleteSession(userId);

    return {
      text: `Ok, minh se mo trang dat cho bai ${nextPending.parkingLotName}, vi tri ${nextPending.slotLabel}, voi xe ${nextPending.vehiclePlate}, tu ${nextPending.startTime} den ${nextPending.endTime}. Neu muon doi vi tri hoac doi bai, ban co the nhan lai trong chat truoc khi xac nhan.`,
      action: 'redirect',
      redirectUrl: `/users/myBooking/${nextPending.parkingLotId}?${params.toString()}`,
      data: { pendingBooking: nextPending },
    };
  }

  private getSystemPrompt(): string {
    // Prompt nền cho LLM USER: nêu vai trò, nguyên tắc không bịa data và nhúng tài liệu RAG.
    return `Bạn là GoPark AI – trợ lý thông minh của ứng dụng đặt chỗ giữ xe GoPark. Bạn nói chuyện tự nhiên, thân thiện như một người bạn am hiểu về đỗ xe tại Việt Nam.

NGUYÊN TẮC QUAN TRỌNG:
0. Chi tra loi noi dung lien quan den GoPark, bai do xe, dat cho, thanh toan, tai khoan, doanh thu/van hanh/admin. Neu user yeu cau viet code, HTML, kien thuc chung hoac chu de ngoai bai do, phai xin loi va tu choi ngan gon.
1. KHÔNG bao giờ bịa số liệu, giá cả, địa chỉ cụ thể – chỉ dùng dữ liệu từ tool/DB.
2. Trả lời NGẮN GỌN, súc tích. Không lặp lại câu hỏi của user.
3. Nhớ ngữ cảnh cuộc trò chuyện – nếu user vừa hỏi về bãi A thì câu tiếp theo liên quan đến bãi A.
4. Dùng emoji phù hợp nhưng không lạm dụng.
5. Nếu không biết → thành thật nói "Tôi chưa có thông tin về điều này".
6. Hỗ trợ cả tiếng Việt có dấu và không dấu.

KHẢ NĂNG:
- Tìm bãi đỗ: gần nhất, rẻ nhất, phù hợp nhất (dựa trên rating + giá + chỗ trống)
- Đặt chỗ: redirect đến trang đặt với thông tin đã điền sẵn
- Xem tài khoản: số dư ví, xe đã đăng ký, lịch sử đặt
- Hỗ trợ: thanh toán, giờ mở cửa, liên hệ, khuyến mãi
- Trả lời câu hỏi chung về đỗ xe, giao thông, GoPark

GoPark hoạt động 24/7. Hotline: 1800-GOPARK. Website: gopark.vn

TÀI LIỆU HƯỚNG DẪN TỪ FILE MARKDOWN:
${this.guideService.getGuide()}`;
  }

  private getToolsDefinition(): any[] {
    // Khai báo function calling: LLM chỉ được lấy dữ liệu runtime qua các tool này.
    return [
      {
        type: 'function',
        function: {
          name: 'search_parking',
          description:
            'Tìm bãi đỗ xe theo tiêu chí: giá rẻ nhất, gần nhất, đánh giá cao, khu vực, hoặc theo tên bãi',
          parameters: {
            type: 'object',
            properties: {
              criteria: {
                type: 'string',
                enum: [
                  'price_cheapest',
                  'nearest',
                  'best_rating',
                  'area',
                  'by_name',
                ],
              },
              area: {
                type: 'string',
                description: 'Tên quận/huyện (dùng khi criteria=area)',
              },
              name: {
                type: 'string',
                description: 'Tên bãi đỗ cần tìm (dùng khi criteria=by_name)',
              },
              limit: { type: 'integer', default: 5 },
            },
            required: ['criteria'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_user_bookings',
          description: 'Lấy lịch sử đặt chỗ của người dùng',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_wallet_balance',
          description: 'Lấy số dư ví GoPark',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_user_vehicles',
          description: 'Lấy danh sách xe của người dùng',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'book_parking',
          description:
            'Tạo booking mới. Nếu thiếu thông tin, trả về missing_fields.',
          parameters: {
            type: 'object',
            properties: {
              parkingLotId: { type: 'string' },
              startTime: { type: 'string', format: 'date-time' },
              endTime: { type: 'string', format: 'date-time' },
              vehicleId: { type: 'string' },
              slotId: { type: 'string' },
              paymentMethod: {
                type: 'string',
                enum: ['WALLET', 'VNPAY', 'CASH'],
              },
            },
            required: [
              'parkingLotId',
              'startTime',
              'endTime',
              'vehicleId',
              'paymentMethod',
            ],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'cancel_booking',
          description: 'Hủy booking theo ID',
          parameters: {
            type: 'object',
            properties: { bookingId: { type: 'string' } },
            required: ['bookingId'],
          },
        },
      },
    ];
  }

  private async executeTool(
    toolCall: any,
    userId?: string,
    context?: any,
  ): Promise<any> {
    // Router thực thi tool do LLM yêu cầu, map tên tool sang hàm query/mutation nội bộ.
    const { name, arguments: args } = toolCall.function;
    const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args || {};
    this.logger.log(
      `Tool called: ${name} with args: ${JSON.stringify(parsedArgs)}`,
    );

    switch (name) {
      case 'search_parking':
        return this.searchParking(parsedArgs, userId);
      case 'get_user_bookings':
        return this.getUserBookings(userId);
      case 'get_wallet_balance':
        return this.getWalletBalance(userId);
      case 'get_user_vehicles':
        return this.getUserVehicles(userId);
      case 'book_parking':
        return this.createBooking(parsedArgs, userId, context);
      case 'cancel_booking':
        return this.cancelBooking(parsedArgs.bookingId, userId);
      default:
        return { error: 'Tool không tồn tại' };
    }
  }

  private async searchParking(
    args: { criteria: string; area?: string; limit?: number; name?: string; userLat?: number; userLng?: number },
    userId?: string,
  ): Promise<any> {
    let lots = await this.getParkingLotsRaw();
    const { criteria, area, limit = 5, name, userLat, userLng } = args;

    // Tính khoảng cách Haversine (km)
    const calcDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
      const R = 6371;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLng = ((lng2 - lng1) * Math.PI) / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    // Gắn distance vào mỗi lot nếu có tọa độ user
    if (userLat && userLng) {
      lots = lots.map((lot: any) => ({
        ...lot,
        distance_km: lot.lat && lot.lng ? parseFloat(calcDistance(userLat, userLng, Number(lot.lat), Number(lot.lng)).toFixed(1)) : null,
      }));
    }

    if (criteria === 'by_name' && name) {
      lots = lots.filter((lot) => lot.name.toLowerCase().includes(name.toLowerCase()));
      if (lots.length === 0) {
        return {
          message: `Không tìm thấy bãi đỗ nào có tên "${name}". Bạn có muốn tìm bãi ở khu vực ${name} không?`,
          lots: [],
          suggestedArea: name,
        };
      }
      lots.sort((a, b) => b.avgRating - a.avgRating);

    } else if (criteria === 'area' && area) {
      let normalizedArea = area.toLowerCase();
      if (normalizedArea.includes('sài gòn')) normalizedArea = 'hồ chí minh';
      lots = lots.filter((lot) => lot.address.toLowerCase().includes(normalizedArea));
      if (lots.length === 0) {
        return { message: `📍 GoPark chưa có bãi tại "${area}". Thử tìm ở Đà Nẵng hoặc TP.HCM.`, lots: [] };
      }
      lots.sort((a, b) => a.hourly_rate - b.hourly_rate);

    } else if (criteria === 'price_cheapest') {
      // Sắp xếp theo giá tăng dần, ưu tiên còn chỗ
      lots = lots.filter(l => l.available_slots > 0);
      lots.sort((a, b) => a.hourly_rate - b.hourly_rate || b.available_slots - a.available_slots);

    } else if (criteria === 'nearest') {
      // Sắp xếp theo khoảng cách nếu có GPS, fallback theo available_slots
      if (userLat && userLng) {
        lots = lots.filter((l: any) => l.distance_km !== null);
        lots.sort((a: any, b: any) => a.distance_km - b.distance_km);
      } else {
        lots.sort((a, b) => b.available_slots - a.available_slots);
      }

    } else if (criteria === 'best_rating') {
      // Điểm tổng hợp: rating (40%) + chỗ trống (30%) + giá rẻ (30%)
      const maxRate = Math.max(...lots.map(l => l.hourly_rate)) || 1;
      const maxSlots = Math.max(...lots.map(l => l.available_slots)) || 1;
      lots = lots.filter(l => l.available_slots > 0);
      lots.sort((a, b) => {
        const scoreA = (a.avgRating / 5) * 40 + (a.available_slots / maxSlots) * 30 + (1 - a.hourly_rate / maxRate) * 30;
        const scoreB = (b.avgRating / 5) * 40 + (b.available_slots / maxSlots) * 30 + (1 - b.hourly_rate / maxRate) * 30;
        return scoreB - scoreA;
      });

    } else {
      lots.sort((a, b) => a.hourly_rate - b.hourly_rate);
    }

    const results = lots.slice(0, limit);
    return { lots: results, action: 'list_parking', criteria };
  }

  private async getUserBookings(userId?: string): Promise<any> {
    if (!userId) return { error: 'Cần đăng nhập' };
    try {
      const bookings = await this.dataSource.query(
        `SELECT b.id, b.start_time, b.end_time, b.status,
                pl.name as lot_name
         FROM bookings b
         JOIN parking_slots ps ON b.slot_id = ps.id
         JOIN parking_zones pz ON ps.parking_zone_id = pz.id
         JOIN parking_floors pf ON pz.parking_floor_id = pf.id
         JOIN parking_lots pl ON pf.parking_lot_id = pl.id
         WHERE b.user_id = $1
         ORDER BY b.created_at DESC LIMIT 5`,
        [userId],
      );
      return { bookings };
    } catch {
      const bookings = await this.dataSource.query(
        `SELECT id, start_time, end_time, status
         FROM bookings
         WHERE user_id = $1
         ORDER BY created_at DESC LIMIT 5`,
        [userId],
      );
      return { bookings };
    }
  }

  private async getWalletBalance(userId?: string): Promise<any> {
    if (!userId) return { error: 'Cần đăng nhập' };
    const wallet = await this.dataSource.query(
      `SELECT balance FROM wallets WHERE user_id = $1`,
      [userId],
    );
    return { balance: wallet[0]?.balance || 0 };
  }

  private async getUserVehicles(userId?: string): Promise<any> {
    if (!userId) return { error: 'Cần đăng nhập' };
    const vehicles = await this.dataSource.query(
      `SELECT id, plate_number, type FROM vehicles WHERE user_id = $1`,
      [userId],
    );
    return { vehicles };
  }

  private async getUserAccountOverview(userId: string): Promise<any> {
    const [wallet, vehicles, bookings] = await Promise.all([
      this.getWalletBalance(userId),
      this.getUserVehicles(userId),
      this.getUserBookings(userId),
    ]);
    const vehicleList = vehicles.vehicles || [];
    const bookingList = bookings.bookings || [];
    const activeBookings = bookingList.filter((booking: any) =>
      ['PENDING', 'CONFIRMED', 'ONGOING'].includes(String(booking.status || '').toUpperCase()),
    );

    return {
      text:
        `## Tổng Quan Tài Khoản\n\n` +
        this.markdownTable(['Hạng mục', 'Giá trị'], [
          ['Số dư ví', `${Number(wallet.balance || 0).toLocaleString('vi-VN')}đ`],
          ['Xe đã đăng ký', vehicleList.length],
          ['Booking gần đây', bookingList.length],
          ['Booking đang theo dõi', activeBookings.length],
        ]) +
        `\n\n### Gợi ý tiếp theo\n` +
        `- \`xe của tôi\` để xem danh sách biển số\n` +
        `- \`lịch sử đặt của tôi\` để xem booking gần đây\n` +
        `- \`đặt bãi\` để tạo lượt đặt mới`,
      data: {
        action: 'user_account_overview',
        walletBalance: wallet.balance || 0,
        vehicles: vehicleList.length,
        recentBookings: bookingList.length,
        activeBookings: activeBookings.length,
      },
    };
  }

  private async createBooking(
    args: any,
    userId?: string,
    context?: any,
  ): Promise<any> {
    if (!userId) return { error: 'Cần đăng nhập để đặt bãi' };

    let { parkingLotId, startTime, endTime, vehicleId, paymentMethod, slotId } = args;

    // Gộp thông tin từ context đang có (nếu có)
    const pending = context?.pendingBooking || {};
    parkingLotId = parkingLotId || pending.parkingLotId;
    startTime = startTime || pending.startTime;
    endTime = endTime || pending.endTime;
    vehicleId = vehicleId || pending.vehicleId;
    paymentMethod = paymentMethod || pending.paymentMethod;
    slotId = slotId || pending.slotId;

    const missing: string[] = [];
    if (!parkingLotId) missing.push('bãi đỗ');
    if (!startTime || !endTime) missing.push('thời gian');
    if (!vehicleId) missing.push('xe');
    if (!paymentMethod) missing.push('phương thức thanh toán');

    if (missing.length) {
      return {
        error: 'missing_fields',
        fields: missing,
        partialData: {
          parkingLotId,
          startTime,
          endTime,
          vehicleId,
          slotId,
          paymentMethod,
        },
        message: `Thiếu: ${missing.join(', ')}`,
      };
    }

    const start = new Date(startTime);
    const end = new Date(endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime()))
      return { error: 'Thời gian không hợp lệ' };
    if (start >= end)
      return { error: 'Thời gian kết thúc phải sau thời gian bắt đầu' };

    const lot = await this.dataSource
      .getRepository(ParkingLot)
      .findOne({ where: { id: parseInt(parkingLotId, 10) } });
    if (!lot) return { error: 'Không tìm thấy bãi đỗ' };

    const params = new URLSearchParams({
      start: startTime,
      end: endTime,
      vehicle: vehicleId,
      payment: paymentMethod,
    });
    if (slotId) params.set('slot', String(slotId));
    const redirectUrl = `/users/mybooking/${parkingLotId}?${params.toString()}`;

    return {
      success: true,
      action: 'redirect',
      redirectUrl,
      message: `✅ Đã ghi nhận thông tin. Vui lòng xác nhận trên trang đặt chỗ.`,
    };
  }

  private async cancelBooking(
    bookingId: string,
    userId?: string,
  ): Promise<any> {
    if (!userId) return { error: 'Cần đăng nhập' };
    const booking = await this.dataSource.query(
      `SELECT id, status FROM bookings WHERE id = $1 AND user_id = $2`,
      [bookingId, userId],
    );
    if (!booking.length) return { error: 'Không tìm thấy booking' };
    if (booking[0].status !== 'PENDING' && booking[0].status !== 'CONFIRMED') {
      return { error: `Chỉ hủy được booking ở trạng thái PENDING/CONFIRMED` };
    }
    await this.dataSource.query(
      `UPDATE bookings SET status = 'COMPLETED' WHERE id = $1`,
      [bookingId],
    );
    return { success: true, message: `Đã hủy booking #${bookingId}` };
  }

  private async getParkingLotsRaw(): Promise<
    (ParkingLot & { avgRating: number; hourly_rate: number })[]
  > {
    const lots = await this.dataSource.getRepository(ParkingLot).find({
      where: { status: 'ACTIVE' },
      relations: [
        'review',
        'parkingFloor',
        'parkingFloor.parkingZones',
        'parkingFloor.parkingZones.pricingRule',
      ],
      take: 50,
    });
    return lots.map((lot: any) => {
      let avgRating = 0;
      if (lot.review?.length) {
        avgRating =
          lot.review.reduce((s: number, r: any) => s + (r.rating || 0), 0) /
          lot.review.length;
      }
      let hourly_rate = 20000;
      if (lot.parkingFloor?.length) {
        for (const floor of lot.parkingFloor) {
          for (const zone of floor.parkingZones || []) {
            if (zone.pricingRule?.length) {
              hourly_rate = zone.pricingRule[0]?.price_per_hour || 20000;
              break;
            }
          }
        }
      }
      return { ...lot, avgRating, hourly_rate };
    });
  }

  async createBookingFromForm(bookingData: any, userId: string): Promise<any> {
    // Giữ nguyên như cũ
    const { parkingLotId, startTime, endTime, vehicleId, paymentMethod, slotId } =
      bookingData;
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime()))
      throw new Error('Ngày giờ không hợp lệ');
    if (start >= end)
      throw new Error('Thời gian kết thúc phải sau thời gian bắt đầu');

    const lot = await this.dataSource.getRepository(ParkingLot).findOne({
      where: { id: parseInt(parkingLotId, 10) },
      relations: [
        'parkingFloor',
        'parkingFloor.parkingZones',
        'parkingFloor.parkingZones.pricingRule',
      ],
    });
    let hourlyRate = 20000;
    if (lot?.parkingFloor?.length) {
      for (const floor of lot.parkingFloor) {
        for (const zone of floor.parkingZones || []) {
          if (zone.pricingRule?.length) {
            hourlyRate = zone.pricingRule[0]?.price_per_hour || 20000;
            break;
          }
        }
      }
    }
    const hours = Math.max(
      1,
      Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60)),
    );
    const totalAmount = hours * hourlyRate;

    const newBooking = await this.dataSource.transaction(async (manager) => {
      const slotQuery = slotId
        ? `SELECT ps.*
           FROM parking_slots ps
           JOIN parking_zones pz ON pz.id = ps.parking_zone_id
           JOIN parking_floors pf ON pf.id = pz.parking_floor_id
           WHERE pf.parking_lot_id = $1
             AND ps.id = $4
             AND ps.status = 'AVAILABLE'
             AND NOT EXISTS (
               SELECT 1
               FROM bookings b
               WHERE b.slot_id = ps.id
                 AND b.status IN ('PENDING', 'CONFIRMED', 'ONGOING')
                 AND b.start_time < $3
                 AND b.end_time > $2
             )
           LIMIT 1`
        : `SELECT ps.*
           FROM parking_slots ps
           JOIN parking_zones pz ON pz.id = ps.parking_zone_id
           JOIN parking_floors pf ON pf.id = pz.parking_floor_id
           WHERE pf.parking_lot_id = $1
             AND ps.status = 'AVAILABLE'
             AND NOT EXISTS (
               SELECT 1
               FROM bookings b
               WHERE b.slot_id = ps.id
                 AND b.status IN ('PENDING', 'CONFIRMED', 'ONGOING')
                 AND b.start_time < $3
                 AND b.end_time > $2
             )
           ORDER BY ps.id ASC
           LIMIT 1`;
      const availableSlots = await manager.query(
        slotQuery,
        slotId ? [parkingLotId, start, end, slotId] : [parkingLotId, start, end],
      );
      if (!availableSlots.length) throw new Error('Hết chỗ trống');
      const booking = await manager.query(
        `INSERT INTO bookings (user_id, slot_id, vehicle_id, start_time, end_time, total_amount, payment_method, status, created_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', NOW()) RETURNING id`,
        [
          userId,
          availableSlots[0].id,
          vehicleId,
          start,
          end,
          totalAmount,
          paymentMethod,
        ],
      );
      await manager.query(
        `UPDATE parking_slots SET status = 'BOOKED' WHERE id = $1`,
        [availableSlots[0].id],
      );
      return booking[0];
    });
    let redirectUrl = '';
    if (paymentMethod === 'WALLET')
      redirectUrl = `/payment/wallet/${newBooking.id}`;
    else if (paymentMethod === 'VNPAY')
      redirectUrl = `/payment/vnpay/${newBooking.id}`;
    else redirectUrl = `/users/mybooking/confirm/${newBooking.id}`;
    return { bookingId: newBooking.id, totalAmount, redirectUrl };
  }

  private async fallbackProcess(
    messages: any[],
    userId?: string,
  ): Promise<any> {
    // Fallback rule-based khi không có model hoặc LLM lỗi.
    const lastMsg =
      messages.filter((m) => m.role === 'user').pop()?.content || '';
    const normalized = this.normalizeText(lastMsg);

    if (normalized.includes('tim bai') || normalized.includes('bai do') || normalized.includes('cho do')) {
      const lots = await this.getParkingLotsRaw();
      const top = lots.slice(0, 3);
      let text = 'Kết quả tìm bãi hiện có:\n';
      top.forEach((l, i) => {
        text += `${i + 1}. ${l.name} - ${Number(l.hourly_rate).toLocaleString('vi-VN')}đ/giờ (${Number(l.avgRating || 0).toFixed(1)} sao)\n`;
      });
      return { text, data: { lots: top, action: 'list_parking' } };
    }

    if (/^(hi|hello|chao|xin chao|hey)\b/.test(normalized)) {
      return {
        text: 'Chào bạn, mình là trợ lý GoPark. Bạn có thể hỏi tự nhiên về tìm bãi, đặt chỗ, ví, xe hoặc lịch sử đặt.',
      };
    }

    if (normalized.includes('cam on') || normalized.includes('thanks')) {
      return { text: 'Khong co gi. Khi can tim bai hoac dat cho, ban cu nhan thong tin dang co.' };
    }

    if (normalized.includes('ban la ai') || normalized.includes('tro ly')) {
      return { text: 'Minh la tro ly GoPark, ho tro tim bai do, gom thong tin dat cho va tra cuu du lieu tai khoan khi ban da dang nhap.' };
    }

    if (
      normalized.includes('lam duoc gi') ||
      normalized.includes('giup duoc gi') ||
      normalized.includes('chuc nang') ||
      normalized.includes('cong viec gi') ||
      normalized.includes('ban co the lam')
    ) {
      return {
        text:
          'Minh co the ho tro cac viec sau:\n\n' +
          this.markdownTable(['Nhom viec', 'Vi du ban co the hoi'], [
            ['Tim bai', 'Top 10 bai danh gia cao nhat, bai re nhat, bai mac nhat, bai con nhieu cho trong'],
            ['Dat cho', 'Dat bai, roi chon bai, thoi gian va xe theo tung buoc'],
            ['Tai khoan', 'Xem xe da dang ky, so du vi, lich su dat cho'],
            ['Ho tro chung', 'Hoi ve thanh toan, cach dung GoPark, lien he ho tro'],
          ]),
      };
    }

    if (normalized.includes('thanh toan') || normalized.includes('vnpay') || normalized.includes('vi gopark')) {
      return {
        text: 'GoPark ho tro VNPAY, Vi GoPark va tien mat tuy bai. Khi dat cho, neu ban khong chon phuong thuc, minh se de mac dinh la VNPAY.',
      };
    }

    return {
      text: this.getVariedFallback(normalized),
    };
  }

  private getVariedFallback(normalizedMessage: string): string {
    const variants = [
      'Mình chưa đủ dữ liệu để trả lời chắc câu này. Bạn có thể hỏi cụ thể hơn, ví dụ: "top 10 bãi đánh giá cao nhất" hoặc "bãi nào mắc nhất".',
      'Câu này chưa khớp dữ liệu mình có thể truy vấn trực tiếp. Nếu bạn hỏi về bãi đỗ, giá, đánh giá, chỗ trống, xe, ví hoặc lịch sử đặt, mình sẽ trả lời bằng dữ liệu.',
      'Mình hiểu đây là câu hỏi ngoài luồng chính. Bạn có thể diễn đạt lại theo dữ liệu cần xem, như "show bãi rẻ nhất", "bãi nhiều chỗ trống", hoặc "tôi có thể nhờ bạn làm gì".',
    ];
    const seed = normalizedMessage.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return variants[seed % variants.length];
  }

  async checkModels(): Promise<any> {
    return { groq: { ok: this.groq !== null } };
  }

  // ─── SESSION MANAGEMENT ───────────────────────────────────────────────────

  async getUserSessions(userId: string): Promise<any> {
    const sessions = await this.sessionRepo.find({
      where: { userId, title: Not(Like('[OWNER]%')) },
      order: { updatedAt: 'DESC' },
      select: ['id', 'title', 'isActive', 'createdAt', 'updatedAt'],
    });
    return sessions.filter((session) => !session.title?.startsWith('[ADMIN]'));
  }

  async createSession(userId: string, title?: string): Promise<any> {
    const session = this.sessionRepo.create({
      userId,
      title: title || `Cuộc trò chuyện ${new Date().toLocaleDateString('vi-VN')}`,
      messages: [],
      isActive: true,
    });
    const saved = await this.sessionRepo.save(session);
    await this.pruneUserSessions(userId);
    return saved;
  }

  async getSession(sessionId: string, userId: string): Promise<any> {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId, userId } });
    if (!session) return { messages: [] };
    return session;
  }

  async updateSession(sessionId: string, userId: string, data: any): Promise<any> {
    await this.sessionRepo.update({ id: sessionId, userId }, data);
    return { success: true };
  }

  async deleteSession(sessionId: string, userId: string): Promise<any> {
    await this.sessionRepo.delete({ id: sessionId, userId });
    return { success: true };
  }

  private async pruneUserSessions(userId: string): Promise<void> {
    const sessions = await this.sessionRepo.find({
      where: { userId, title: Not(Like('[OWNER]%')) },
      order: { updatedAt: 'DESC' },
      select: ['id', 'title', 'updatedAt'],
    });
    const userSessions = sessions.filter((session) => !session.title?.startsWith('[ADMIN]'));
    const oldSessions = userSessions.slice(this.maxSessionsPerUser);
    if (!oldSessions.length) return;
    await Promise.all(oldSessions.map((session) => this.sessionRepo.delete({ id: session.id, userId })));
  }

  async processMessageWithSession(
    messages: { role: string; content: string }[],
    userId: string,
    sessionId: string,
    context?: any,
  ): Promise<any> {
    // Lấy session từ DB để có full context
    const session = await this.sessionRepo.findOne({ where: { id: sessionId, userId } });
    if (!session) return { text: '❌ Không tìm thấy session.' };

    // Merge lịch sử session với messages mới
    const fullHistory = [
      ...session.messages.map(m => ({ role: m.role, content: m.content })),
      ...messages,
    ].slice(-20); // Giữ 20 tin nhắn gần nhất để tránh token overflow

    const result = await this.processMessage(fullHistory, userId, context);

    // Lưu messages mới vào session
    const lastUser = messages.filter(m => m.role === 'user').pop();
    const newMessages = [...session.messages];
    if (lastUser) {
      newMessages.push({ role: 'user', content: lastUser.content, timestamp: Date.now() });
    }
    newMessages.push({
      role: 'assistant',
      content: result.text || '',
      type: result.action === 'list_parking' ? 'parking-list' : 'text',
      data: result.data,
      timestamp: Date.now(),
    });

    // Auto-generate title từ tin nhắn đầu tiên
    let title = session.title;
    if (session.messages.length === 0 && lastUser) {
      title = lastUser.content.substring(0, 50) + (lastUser.content.length > 50 ? '...' : '');
    }

    await this.sessionRepo.update(
      { id: sessionId, userId },
      { messages: newMessages.slice(-50), title }, // Giữ tối đa 50 tin nhắn
    );

    return result;
  }

  async streamToResponse(messages: any[], res: any, userId?: string) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    try {
      const result = await this.processMessage(messages, userId);
      res.write(`data: ${JSON.stringify(result)}\n\n`);
    } catch (err) {
      res.write(
        `event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`,
      );
    } finally {
      res.write('event: done\ndata: {}\n\n');
      res.end();
    }
  }
}

