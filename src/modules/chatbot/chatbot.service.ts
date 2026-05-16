import { Injectable, Logger } from '@nestjs/common';
import { DataSource, Like, Not, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import Groq from 'groq-sdk';
import { ParkingLot } from '../parking-lot/entities/parking-lot.entity';
import { ChatbotStateService } from './chatbot-state.service';
import { classifyIntent, requiresData, INTENT_DB_CONFIG, extractParkingName, ChatbotIntent } from './Chatbot.intent';
import { ChatbotSession } from './entities/chatbot-session.entity';
import { ChatbotGuideService } from './chatbot-guide.service';

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);
  private groq: Groq | null = null;
  private readonly maxSessionsPerUser = 20;

  constructor(
    private readonly dataSource: DataSource,
    private readonly stateService: ChatbotStateService,
    private readonly guideService: ChatbotGuideService,
    @InjectRepository(ChatbotSession)
    private readonly sessionRepo: Repository<ChatbotSession>,
  ) {
    const apiKey = process.env.GROQ_API_KEY || process.env.GORQ_API_KEY;
    if (!apiKey) {
      this.logger.warn('GROQ_API_KEY missing, chatbot cháº¡y cháº¿ Ä‘á»™ fallback');
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
    // Láº¥y cÃ¢u cuá»‘i cá»§a ngÆ°á»i dÃ¹ng
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || '';
    const intent = classifyIntent(lastUserMessage);
    this.logger.log(`Intent: ${intent} | Message: ${lastUserMessage}`);
    const session = userId ? this.stateService.getSession(userId) : undefined;
    const sessionContext = session?.context ?? {};
    const sessionPendingBooking = sessionContext.pendingBooking ?? {};
    if (session?.step === 'awaiting_booking_details' && this.isBookingCancelMessage(lastUserMessage)) {
      this.stateService.deleteSession(userId!);
      return { text: 'Mình đã thoát khỏi form đặt bãi. Bạn có thể hỏi tiếp về bãi đỗ, giá, đánh giá, ví, xe hoặc lịch sử đặt chỗ.' };
    }
    const shouldContinueBooking =
      session?.step === 'awaiting_booking_details' &&
      this.isBookingContinuationMessage(lastUserMessage, sessionPendingBooking);
    const dataAnswer = await this.answerPublicParkingDataQuestion(lastUserMessage);
    if (dataAnswer) return dataAnswer;

    // ----- Xá»¬ LÃ CÃC INTENT Cáº¦N DATA -----
    if (requiresData(intent) && INTENT_DB_CONFIG[intent]) {
      const config = INTENT_DB_CONFIG[intent];
      // Kiá»ƒm tra Ä‘Äƒng nháº­p náº¿u cáº§n
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
          // PhÃ¢n biá»‡t: ráº» nháº¥t â†’ price_cheapest, phÃ¹ há»£p nháº¥t â†’ best_rating
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

    // ----- Xá»¬ LÃ  Ä áº¶T BÃƒI (BOOK_PARKING / BOOK_WITH_DETAILS) -----
    if (
      (intent === ChatbotIntent.BOOK_PARKING ||
        intent === ChatbotIntent.BOOK_WITH_DETAILS ||
        shouldContinueBooking) &&
      !this.isBookingMetaQuestion(lastUserMessage)
    ) {
      if (!userId) {
        return { text: 'âš ï¸  Báº¡n cáº§n Ä‘Äƒng nháº­p Ä‘á»ƒ Ä‘áº·t bÃ£i. Vui lÃ²ng Ä‘Äƒng nháº­p Ä‘á»ƒ tiáº¿p tá»¥c Ä‘áº·t chá»—.' };
      }

      // Náº¿u lÃ  cÃ¢u há» i hÆ°á»›ng dáº«n â†’ dÃ¹ng Groq
      const msgLower = lastUserMessage.toLowerCase();
      if (
        msgLower.includes('cách') || msgLower.includes('như thế nào') ||
        msgLower.includes('hướng dẫn') || msgLower.includes('làm sao') ||
        msgLower.includes('bước') || msgLower.includes('quy trình') ||
        msgLower.includes('cach') || msgLower.includes('huong dan')
      ) {
        if (this.groq) {
          const resp = await this.groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'system', content: this.getSystemPrompt() }, ...messages.slice(-4)] as any,
            temperature: 0.7,
          });
          return { text: resp.choices[0].message.content || 'Vui long chon bai do, sau do nhan Dat ngay de dat cho.' };
        }
        return { text: 'De dat bai: tim bai phu hop, chon thoi gian, xe, phuong thuc thanh toan, roi xac nhan dat cho.' };
      }

      return this.handleSmartBooking(lastUserMessage, userId, context, sessionPendingBooking);
    }

    // ----- FALLBACK: Gá»ŒI GROQ CHO CÃC CÃ‚U Há»ŽI THÆ¯á»œNG (FREE_FORM) -----
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
      if (!this.groq) {
        return await this.fallbackProcess(messages, userId);
      }
      const systemPrompt = this.getSystemPrompt();
      const recentMessages = messages.slice(-6);
      const response = await this.groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          ...recentMessages,
        ] as any,
        temperature: 0.7,
      });
      const text = response.choices[0].message.content || 'Xin lá»—i, tÃ´i chÆ°a hiá»ƒu cÃ¢u há» i cá»§a báº¡n.';
      return { text };
    }

    // Má» i intent cÃ²n láº¡i â†’ Groq xá»­ lÃ½ thay vÃ¬ fallback cá»©ng
    if (this.groq) {
      const response = await this.groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: this.getSystemPrompt() },
          ...messages.slice(-6),
        ] as any,
        temperature: 0.7,
      });
      return { text: response.choices[0].message.content || 'Xin lá»—i, tÃ´i chÆ°a hiá»ƒu cÃ¢u há»i cá»§a báº¡n.' };
    }
    return await this.fallbackProcess(messages, userId);
  } catch (error) {
    this.logger.error('processMessage error', error);
    return await this.fallbackProcess(messages, userId);
  }
  }

  private normalizeText(value: string): string {
    return (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
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
      /\b(top|danh gia|mac nhat|dat nhat|re nhat|gia cao|gia re|nhieu cho|con trong|lam duoc gi|giup duoc gi|cong viec|chuc nang|ban la ai|cach dung|he thong|ngoai dat bai)\b/.test(text);
    if (asksDifferentQuestion) return false;

    if (/^(bai|xe|thanh toan|payment|tra tien)\s*\d+$/.test(text)) return true;
    if (this.parsePaymentMethod(message)) return true;
    if (this.parseBookingTimes(message).startTime) return true;
    if (/\b(ngay mai|hom nay|tu\s*\d{1,2}|luc\s*\d{1,2}|\d{1,2}h|den\s*\d{1,2})\b/.test(text)) return true;
    if (/\b(xe|bien so|oto|o to|car|motor|moto)\b/.test(text)) return true;
    if (!pending?.parkingLotId && /\b(bai|bai do|parking|do xe)\b/.test(text)) return true;

    return false;
  }

  private isBookingMetaQuestion(message: string): boolean {
    const text = this.normalizeText(message);
    return (
      text.includes('ngoai dat bai') ||
      (text.includes('dat bai') && /\b(lam duoc gi|giup duoc gi|cong viec|chuc nang|co the lam|cach dung|he thong)\b/.test(text))
    );
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
      /^(bai|xe|thanh toan|payment|tra tien)\s*\d+$/.test(text);
    if (isOnlyNumberedChoice) return {};

    const now = new Date();
    const base = new Date(now);
    if (text.includes('ngay mai') || text.includes('tomorrow')) {
      base.setDate(base.getDate() + 1);
    }

    const fromTo = text.match(/(?:tu|luc)?\s*(\d{1,2})(?:h|:)?(\d{2})?\s*(?:den|toi|-)\s*(\d{1,2})(?:h|:)?(\d{2})?/);
    if (fromTo) {
      const start = new Date(base);
      start.setHours(Number(fromTo[1]), Number(fromTo[2] || 0), 0, 0);
      const end = new Date(base);
      end.setHours(Number(fromTo[3]), Number(fromTo[4] || 0), 0, 0);
      if (end <= start) end.setDate(end.getDate() + 1);
      return {
        startTime: this.toLocalInputDateTime(start),
        endTime: this.toLocalInputDateTime(end),
      };
    }

    const duration = text.match(/(?:trong|dat)\s*(\d{1,2})\s*(?:gio|tieng|h)/);
    const singleTime = text.match(/(?:luc|tu)?\s*(\d{1,2})(?:h|:)?(\d{2})?/);
    if (singleTime) {
      const start = new Date(base);
      start.setHours(Number(singleTime[1]), Number(singleTime[2] || 0), 0, 0);
      if (start < now && !text.includes('ngay mai')) start.setDate(start.getDate() + 1);
      const end = new Date(start);
      end.setHours(end.getHours() + Number(duration?.[1] || 1));
      return {
        startTime: this.toLocalInputDateTime(start),
        endTime: this.toLocalInputDateTime(end),
      };
    }

    return {};
  }

  private toLocalInputDateTime(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

  private getDynamicTimeSuggestions(): string[] {
    const now = new Date();
    const currentHour = now.getHours();
    const h1 = (currentHour + 1) % 24;
    const h2 = (currentHour + 3) % 24;
    return [
      `hom nay tu ${h1}h den ${h2}h`,
      'ngay mai tu 7h30 den 9h',
      `luc ${h1}h trong 2 gio`,
    ];
  }

  private formatTimeExamples(): string {
    const times = this.getDynamicTimeSuggestions();
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
    const pending = {
      ...(sessionPendingBooking || {}),
      ...(context?.pendingBooking || {}),
    };
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

    const nextPending = {
      ...pending,
      parkingLotId: lot?.id ? String(lot.id) : pending.parkingLotId,
      parkingLotName: lot?.name || pending.parkingLotName || 'Bãi đỗ',
      vehicleId: vehicle?.id ? String(vehicle.id) : pending.vehicleId,
      vehiclePlate: vehicle?.plate_number || pending.vehiclePlate,
      startTime: times.startTime || pending.startTime,
      endTime: times.endTime || pending.endTime,
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
    if (!nextPending.vehiclePlate) missing.push('xe hoac bien so');

    if (missing.length) {
      this.stateService.updateStep(userId, 'awaiting_booking_details', { pendingBooking: nextPending });
      const nextField = missing[0];
      const bookingStatus = this.markdownTable(['Thong tin', 'Trang thai'], [
        ['Bai do', nextPending.parkingLotName ? this.cleanDisplayText(nextPending.parkingLotName) : 'Can chon'],
        ['Thoi gian', nextPending.startTime && nextPending.endTime ? `${nextPending.startTime} - ${nextPending.endTime}` : 'Can nhap'],
        ['Xe', nextPending.vehiclePlate || 'Can chon'],
        ['Thanh toan', nextPending.paymentMethod?.toUpperCase() || 'VNPAY'],
      ]);
      const nextHint =
        nextField === 'ten bai do'
          ? this.formatParkingLotOptions(parkingSuggestions)
          : nextField === 'thoi gian vao/ra'
            ? this.formatTimeExamples()
            : nextField === 'xe hoac bien so'
              ? this.formatVehicleOptions(vehicles)
              : this.formatPaymentOptions();
      const nextQuestion =
        nextField === 'ten bai do'
          ? 'Ban muon dat o bai nao?'
          : nextField === 'thoi gian vao/ra'
            ? 'Ban muon gui xe luc nao va lay xe luc nao?'
            : nextField === 'xe hoac bien so'
              ? 'Ban chon xe nao de dat cho?'
              : 'Ban muon thanh toan bang phuong thuc nao?';
      return {
        text: this.cleanChatText(`Minh da ghi nhan ${nextPending.parkingLotName ? `bai **${this.cleanDisplayText(nextPending.parkingLotName)}**` : 'yeu cau dat cho'}.\n\n${bookingStatus}\n\n**${nextQuestion}**${nextHint}`),
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
            payments: [
              { label: 'thanh toan 1', value: 'vnpay' },
              { label: 'thanh toan 2', value: 'wallet' },
              { label: 'thanh toan 3', value: 'cash' },
            ],
            timeExamples: this.getDynamicTimeSuggestions(),
          },
        },
      };
    }

    const params = new URLSearchParams();
    params.set('start', nextPending.startTime);
    params.set('end', nextPending.endTime);
    params.set('vehicle', nextPending.vehiclePlate);
    params.set('payment', nextPending.paymentMethod);
    this.stateService.deleteSession(userId);

    return {
      text: `Ok, minh se mo trang dat cho bai ${nextPending.parkingLotName} voi xe ${nextPending.vehiclePlate}, tu ${nextPending.startTime} den ${nextPending.endTime}.`,
      action: 'redirect',
      redirectUrl: `/users/myBooking/${nextPending.parkingLotId}?${params.toString()}`,
      data: { pendingBooking: nextPending },
    };
  }

  private getSystemPrompt(): string {
    return `Báº¡n lÃ  GoPark AI â€“ trá»£ lÃ½ thÃ´ng minh cá»§a á»©ng dá»¥ng Ä‘áº·t chá»— giá»¯ xe GoPark. Báº¡n nÃ³i chuyá»‡n tá»± nhiÃªn, thÃ¢n thiá»‡n nhÆ° má»™t ngÆ°á»i báº¡n am hiá»ƒu vá» Ä‘á»— xe táº¡i Viá»‡t Nam.

NGUYÃŠN Táº®C QUAN TRá»ŒNG:
1. KHÃ”NG bao giá» bá»‹a sá»‘ liá»‡u, giÃ¡ cáº£, Ä‘á»‹a chá»‰ cá»¥ thá»ƒ â€“ chá»‰ dÃ¹ng dá»¯ liá»‡u tá»« tool/DB.
2. Tráº£ lá»i NGáº®N Gá»ŒN, sÃºc tÃ­ch. KhÃ´ng láº·p láº¡i cÃ¢u há»i cá»§a user.
3. Nhá»› ngá»¯ cáº£nh cuá»™c trÃ² chuyá»‡n â€“ náº¿u user vá»«a há»i vá» bÃ£i A thÃ¬ cÃ¢u tiáº¿p theo liÃªn quan Ä‘áº¿n bÃ£i A.
4. DÃ¹ng emoji phÃ¹ há»£p nhÆ°ng khÃ´ng láº¡m dá»¥ng.
5. Náº¿u khÃ´ng biáº¿t â†’ thÃ nh tháº­t nÃ³i "TÃ´i chÆ°a cÃ³ thÃ´ng tin vá» Ä‘iá»u nÃ y".
6. Há»— trá»£ cáº£ tiáº¿ng Viá»‡t cÃ³ dáº¥u vÃ  khÃ´ng dáº¥u.

KHáº¢ NÄ‚NG:
- TÃ¬m bÃ£i Ä‘á»—: gáº§n nháº¥t, ráº» nháº¥t, phÃ¹ há»£p nháº¥t (dá»±a trÃªn rating + giÃ¡ + chá»— trá»‘ng)
- Äáº·t chá»—: redirect Ä‘áº¿n trang Ä‘áº·t vá»›i thÃ´ng tin Ä‘Ã£ Ä‘iá»n sáºµn
- Xem tÃ i khoáº£n: sá»‘ dÆ° vÃ­, xe Ä‘Ã£ Ä‘Äƒng kÃ½, lá»‹ch sá»­ Ä‘áº·t
- Há»— trá»£: thanh toÃ¡n, giá» má»Ÿ cá»­a, liÃªn há»‡, khuyáº¿n mÃ£i
- Tráº£ lá»i cÃ¢u há»i chung vá» Ä‘á»— xe, giao thÃ´ng, GoPark

GoPark hoáº¡t Ä‘á»™ng 24/7. Hotline: 1800-GOPARK. Website: gopark.vn

TÃ€I LIá»†U HÆ¯á»šNG DáºªN Tá»ª FILE MARKDOWN:
${this.guideService.getGuide()}`;
  }

  private getToolsDefinition(): any[] {
    return [
      {
        type: 'function',
        function: {
          name: 'search_parking',
          description:
            'TÃ¬m bÃ£i Ä‘á»— xe theo tiÃªu chÃ­: giÃ¡ ráº» nháº¥t, gáº§n nháº¥t, Ä‘Ã¡nh giÃ¡ cao, khu vá»±c, hoáº·c theo tÃªn bÃ£i',
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
                description: 'TÃªn quáº­n/huyá»‡n (dÃ¹ng khi criteria=area)',
              },
              name: {
                type: 'string',
                description: 'TÃªn bÃ£i Ä‘á»— cáº§n tÃ¬m (dÃ¹ng khi criteria=by_name)',
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
          description: 'Láº¥y lá»‹ch sá»­ Ä‘áº·t chá»— cá»§a ngÆ°á»i dÃ¹ng',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_wallet_balance',
          description: 'Láº¥y sá»‘ dÆ° vÃ­ GoPark',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_user_vehicles',
          description: 'Láº¥y danh sÃ¡ch xe cá»§a ngÆ°á»i dÃ¹ng',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'book_parking',
          description:
            'Táº¡o booking má»›i. Náº¿u thiáº¿u thÃ´ng tin, tráº£ vá» missing_fields.',
          parameters: {
            type: 'object',
            properties: {
              parkingLotId: { type: 'string' },
              startTime: { type: 'string', format: 'date-time' },
              endTime: { type: 'string', format: 'date-time' },
              vehicleId: { type: 'string' },
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
          description: 'Há»§y booking theo ID',
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
        return { error: 'Tool khÃ´ng tá»“n táº¡i' };
    }
  }

  private async searchParking(
    args: { criteria: string; area?: string; limit?: number; name?: string; userLat?: number; userLng?: number },
    userId?: string,
  ): Promise<any> {
    let lots = await this.getParkingLotsRaw();
    const { criteria, area, limit = 5, name, userLat, userLng } = args;

    // TÃ­nh khoáº£ng cÃ¡ch Haversine (km)
    const calcDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
      const R = 6371;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLng = ((lng2 - lng1) * Math.PI) / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    // Gáº¯n distance vÃ o má»—i lot náº¿u cÃ³ tá»a Ä‘á»™ user
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
          message: `âŒ KhÃ´ng tÃ¬m tháº¥y bÃ£i Ä‘á»— nÃ o cÃ³ tÃªn "${name}". Báº¡n cÃ³ muá»‘n tÃ¬m bÃ£i á»Ÿ khu vá»±c ${name} khÃ´ng?`,
          lots: [],
          suggestedArea: name,
        };
      }
      lots.sort((a, b) => b.avgRating - a.avgRating);

    } else if (criteria === 'area' && area) {
      let normalizedArea = area.toLowerCase();
      if (normalizedArea.includes('sÃ i gÃ²n')) normalizedArea = 'há»“ chÃ­ minh';
      lots = lots.filter((lot) => lot.address.toLowerCase().includes(normalizedArea));
      if (lots.length === 0) {
        return { message: `ðŸ“ GoPark chÆ°a cÃ³ bÃ£i táº¡i "${area}". Thá»­ tÃ¬m á»Ÿ ÄÃ  Náºµng hoáº·c TP.HCM.`, lots: [] };
      }
      lots.sort((a, b) => a.hourly_rate - b.hourly_rate);

    } else if (criteria === 'price_cheapest') {
      // Sáº¯p xáº¿p theo giÃ¡ tÄƒng dáº§n, Æ°u tiÃªn cÃ²n chá»—
      lots = lots.filter(l => l.available_slots > 0);
      lots.sort((a, b) => a.hourly_rate - b.hourly_rate || b.available_slots - a.available_slots);

    } else if (criteria === 'nearest') {
      // Sáº¯p xáº¿p theo khoáº£ng cÃ¡ch náº¿u cÃ³ GPS, fallback theo available_slots
      if (userLat && userLng) {
        lots = lots.filter((l: any) => l.distance_km !== null);
        lots.sort((a: any, b: any) => a.distance_km - b.distance_km);
      } else {
        lots.sort((a, b) => b.available_slots - a.available_slots);
      }

    } else if (criteria === 'best_rating') {
      // Äiá»ƒm tá»•ng há»£p: rating (40%) + chá»— trá»‘ng (30%) + giÃ¡ ráº» (30%)
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
    if (!userId) return { error: 'Cáº§n Ä‘Äƒng nháº­p' };
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
    if (!userId) return { error: 'Cáº§n Ä‘Äƒng nháº­p' };
    const wallet = await this.dataSource.query(
      `SELECT balance FROM wallets WHERE user_id = $1`,
      [userId],
    );
    return { balance: wallet[0]?.balance || 0 };
  }

  private async getUserVehicles(userId?: string): Promise<any> {
    if (!userId) return { error: 'Cáº§n Ä‘Äƒng nháº­p' };
    const vehicles = await this.dataSource.query(
      `SELECT id, plate_number, type FROM vehicles WHERE user_id = $1`,
      [userId],
    );
    return { vehicles };
  }

  private async createBooking(
    args: any,
    userId?: string,
    context?: any,
  ): Promise<any> {
    if (!userId) return { error: 'Cáº§n Ä‘Äƒng nháº­p Ä‘á»ƒ Ä‘áº·t bÃ£i' };

    let { parkingLotId, startTime, endTime, vehicleId, paymentMethod } = args;

    // Gá»™p thÃ´ng tin tá»« context Ä‘ang cÃ³ (náº¿u cÃ³)
    const pending = context?.pendingBooking || {};
    parkingLotId = parkingLotId || pending.parkingLotId;
    startTime = startTime || pending.startTime;
    endTime = endTime || pending.endTime;
    vehicleId = vehicleId || pending.vehicleId;
    paymentMethod = paymentMethod || pending.paymentMethod;

    const missing: string[] = [];
    if (!parkingLotId) missing.push('bÃ£i Ä‘á»—');
    if (!startTime || !endTime) missing.push('thá»i gian');
    if (!vehicleId) missing.push('xe');
    if (!paymentMethod) missing.push('phÆ°Æ¡ng thá»©c thanh toÃ¡n');

    if (missing.length) {
      return {
        error: 'missing_fields',
        fields: missing,
        partialData: {
          parkingLotId,
          startTime,
          endTime,
          vehicleId,
          paymentMethod,
        },
        message: `Thiáº¿u: ${missing.join(', ')}`,
      };
    }

    const start = new Date(startTime);
    const end = new Date(endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime()))
      return { error: 'Thá»i gian khÃ´ng há»£p lá»‡' };
    if (start >= end)
      return { error: 'Thá»i gian káº¿t thÃºc pháº£i sau thá»i gian báº¯t Ä‘áº§u' };

    const lot = await this.dataSource
      .getRepository(ParkingLot)
      .findOne({ where: { id: parseInt(parkingLotId, 10) } });
    if (!lot) return { error: 'KhÃ´ng tÃ¬m tháº¥y bÃ£i Ä‘á»—' };

    const params = new URLSearchParams({
      start: startTime,
      end: endTime,
      vehicle: vehicleId,
      payment: paymentMethod,
    });
    const redirectUrl = `/users/mybooking/${parkingLotId}?${params.toString()}`;

    return {
      success: true,
      action: 'redirect',
      redirectUrl,
      message: `âœ… ÄÃ£ ghi nháº­n thÃ´ng tin. Vui lÃ²ng xÃ¡c nháº­n trÃªn trang Ä‘áº·t chá»—.`,
    };
  }

  private async cancelBooking(
    bookingId: string,
    userId?: string,
  ): Promise<any> {
    if (!userId) return { error: 'Cáº§n Ä‘Äƒng nháº­p' };
    const booking = await this.dataSource.query(
      `SELECT id, status FROM bookings WHERE id = $1 AND user_id = $2`,
      [bookingId, userId],
    );
    if (!booking.length) return { error: 'KhÃ´ng tÃ¬m tháº¥y booking' };
    if (booking[0].status !== 'PENDING' && booking[0].status !== 'CONFIRMED') {
      return { error: `Chá»‰ há»§y Ä‘Æ°á»£c booking á»Ÿ tráº¡ng thÃ¡i PENDING/CONFIRMED` };
    }
    await this.dataSource.query(
      `UPDATE bookings SET status = 'COMPLETED' WHERE id = $1`,
      [bookingId],
    );
    return { success: true, message: `ÄÃ£ há»§y booking #${bookingId}` };
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
    // Giá»¯ nguyÃªn nhÆ° cÅ©
    const { parkingLotId, startTime, endTime, vehicleId, paymentMethod } =
      bookingData;
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime()))
      throw new Error('NgÃ y giá» khÃ´ng há»£p lá»‡');
    if (start >= end)
      throw new Error('Thá»i gian káº¿t thÃºc pháº£i sau thá»i gian báº¯t Ä‘áº§u');

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
      const availableSlots = await manager.query(
        `SELECT * FROM parking_slots WHERE parking_zone_id IN (
     SELECT id FROM parking_zones WHERE parking_floor_id IN (
       SELECT id FROM parking_floors WHERE parking_lot_id = $1
     )
   ) AND status = 'AVAILABLE' LIMIT 1`,
        [parkingLotId],
      );
      if (!availableSlots.length) throw new Error('Háº¿t chá»— trá»‘ng');
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

  // â”€â”€â”€ SESSION MANAGEMENT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    // Láº¥y session tá»« DB Ä‘á»ƒ cÃ³ full context
    const session = await this.sessionRepo.findOne({ where: { id: sessionId, userId } });
    if (!session) return { text: 'âŒ KhÃ´ng tÃ¬m tháº¥y session.' };

    // Merge lá»‹ch sá»­ session vá»›i messages má»›i
    const fullHistory = [
      ...session.messages.map(m => ({ role: m.role, content: m.content })),
      ...messages,
    ].slice(-20); // Giá»¯ 20 tin nháº¯n gáº§n nháº¥t Ä‘á»ƒ trÃ¡nh token overflow

    const result = await this.processMessage(fullHistory, userId, context);

    // LÆ°u messages má»›i vÃ o session
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

    // Auto-generate title tá»« tin nháº¯n Ä‘áº§u tiÃªn
    let title = session.title;
    if (session.messages.length === 0 && lastUser) {
      title = lastUser.content.substring(0, 50) + (lastUser.content.length > 50 ? '...' : '');
    }

    await this.sessionRepo.update(
      { id: sessionId, userId },
      { messages: newMessages.slice(-50), title }, // Giá»¯ tá»‘i Ä‘a 50 tin nháº¯n
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
