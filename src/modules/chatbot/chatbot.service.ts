import { Injectable, Logger } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
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

    // ----- Xá»¬ LÃ CÃC INTENT Cáº¦N DATA -----
    if (requiresData(intent) && INTENT_DB_CONFIG[intent]) {
      const config = INTENT_DB_CONFIG[intent];
      // Kiá»ƒm tra Ä‘Äƒng nháº­p náº¿u cáº§n
      if (config.requiresUserId && !userId) {
        return { text: 'âš ï¸ Vui lÃ²ng Ä‘Äƒng nháº­p Ä‘á»ƒ sá»­ dá»¥ng tÃ­nh nÄƒng nÃ y.' };
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
                ? `ðŸ“ TÃ¬m tháº¥y ${result.lots.length} bÃ£i gáº§n báº¡n nháº¥t (cÃ³ khoáº£ng cÃ¡ch).`
                : `ðŸ“ ÄÃ¢y lÃ  ${result.lots.length} bÃ£i Ä‘á»— cÃ²n nhiá»u chá»— trá»‘ng nháº¥t hiá»‡n táº¡i.`,
              action: 'list_parking',
              data: { lots: result.lots, action: 'list_parking', criteria: 'nearest' },
            };
          }
          return { text: 'KhÃ´ng tÃ¬m tháº¥y bÃ£i nÃ o. Vui lÃ²ng thá»­ láº¡i.' };
        }

        case ChatbotIntent.FIND_BEST: {
          // PhÃ¢n biá»‡t: ráº» nháº¥t â†’ price_cheapest, phÃ¹ há»£p nháº¥t â†’ best_rating
          const msg = lastUserMessage.toLowerCase();
          const isCheapest = msg.includes('ráº»') || msg.includes('re ') || msg.includes('re nhat') || msg.includes('gia re') || msg.includes('giÃ¡ ráº»') || msg.includes('cheapest');
          const criteria = isCheapest ? 'price_cheapest' : 'best_rating';
          const limit = isCheapest ? 5 : 1;
          const result = await this.searchParking({ criteria, limit }, userId);
          if (result.lots?.length) {
            if (isCheapest) {
              return {
                text: `ðŸ’° Top ${result.lots.length} bÃ£i giÃ¡ ráº» nháº¥t hiá»‡n cÃ³ (sáº¯p xáº¿p theo giÃ¡/giá» tÄƒng dáº§n):`,
                action: 'list_parking',
                data: { lots: result.lots, action: 'list_parking', criteria: 'price_cheapest' },
              };
            }
            const top = result.lots[0];
            return {
              text: `â­ BÃ£i phÃ¹ há»£p nháº¥t: **${top.name}**\n\nðŸ“Š TiÃªu chÃ­:\nâ€¢ ÄÃ¡nh giÃ¡: ${Number(top.avgRating || 0).toFixed(1)} â­ (40%)\nâ€¢ Chá»— trá»‘ng: ${top.available_slots}/${top.total_slots} (30%)\nâ€¢ GiÃ¡: ${(top.hourly_rate || 20000).toLocaleString('vi-VN')}Ä‘/giá» (30%)`,
              action: 'list_parking',
              data: { lots: result.lots, action: 'list_parking', criteria: 'best' },
            };
          }
          return { text: 'KhÃ´ng tÃ¬m tháº¥y bÃ£i phÃ¹ há»£p.' };
        }

        case ChatbotIntent.CHECK_BOOKING: {
          const data = await this.getUserBookings(userId);
          if (data.error) return { text: data.error };
          const bookings = data.bookings || [];
          if (bookings.length === 0) return { text: 'ðŸ“‹ Báº¡n chÆ°a cÃ³ Ä‘áº·t chá»— nÃ o.' };
          return {
            text:
              `## Lich Su Dat Cho\n\n` +
              this.markdownTable(
                ['#', 'Bai do', 'Bat dau', 'Ket thuc', 'Trang thai'],
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
              `## Vi GoPark\n\n` +
              this.markdownTable(['Hang muc', 'Gia tri'], [
                ['So du hien tai', `${Number(balance).toLocaleString('vi-VN')}d`],
              ]),
          };
        }

        case ChatbotIntent.CHECK_VEHICLES: {
          const data = await this.getUserVehicles(userId);
          if (data.error) return { text: data.error };
          const vehicles = data.vehicles || [];
          if (vehicles.length === 0) return { text: 'ðŸš— Báº¡n chÆ°a Ä‘Äƒng kÃ½ xe nÃ o. VÃ o má»¥c "Xe cá»§a tÃ´i" Ä‘á»ƒ thÃªm xe.' };
          return {
            text:
              `## Xe Da Dang Ky\n\n` +
              this.markdownTable(
                ['Lua chon', 'Bien so', 'Loai xe'],
                vehicles.map((v: any, i: number) => [
                  `xe ${i + 1}`,
                  v.plate_number || '-',
                  v.type || 'Xe hoi',
                ]),
              ) +
              `\n\nKhi dat cho, ban chi can tra loi \`xe 1\` hoac \`xe 2\`.`,
          };
        }

        case ChatbotIntent.CHECK_INVOICE:
          return { text: 'ðŸ“„ TÃ­nh nÄƒng xem hÃ³a Ä‘Æ¡n Ä‘ang Ä‘Æ°á»£c phÃ¡t triá»ƒn. Báº¡n cÃ³ thá»ƒ xem trong trang CÃ¡ nhÃ¢n.' };

        case ChatbotIntent.CANCEL_BOOKING:
          return { text: 'â“ Vui lÃ²ng cung cáº¥p mÃ£ Ä‘áº·t chá»— (ID) báº¡n muá»‘n há»§y.' };

        default:
          // CÃ¡c intent khÃ¡c (náº¿u cÃ³) sáº½ rÆ¡i vÃ o Ä‘Ã¢y
          break;
      }
    }

    // ----- Xá»¬ LÃ Äáº¶T BÃƒI (BOOK_PARKING / BOOK_WITH_DETAILS) -----
    if (
      intent === ChatbotIntent.BOOK_PARKING ||
      intent === ChatbotIntent.BOOK_WITH_DETAILS ||
      session?.step === 'awaiting_booking_details'
    ) {
      if (!userId) {
        return { text: 'âš ï¸ Báº¡n cáº§n Ä‘Äƒng nháº­p Ä‘á»ƒ Ä‘áº·t bÃ£i. Vui lÃ²ng Ä‘Äƒng nháº­p Ä‘á»ƒ tiáº¿p tá»¥c Ä‘áº·t chá»—.' };
      }

      // Náº¿u lÃ  cÃ¢u há»i hÆ°á»›ng dáº«n â†’ dÃ¹ng Groq
      const msgLower = lastUserMessage.toLowerCase();
      if (
        msgLower.includes('cÃ¡ch') || msgLower.includes('nhÆ° tháº¿ nÃ o') ||
        msgLower.includes('hÆ°á»›ng dáº«n') || msgLower.includes('lÃ m sao') ||
        msgLower.includes('bÆ°á»›c') || msgLower.includes('quy trÃ¬nh')
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
      const text = response.choices[0].message.content || 'Xin lá»—i, tÃ´i chÆ°a hiá»ƒu cÃ¢u há»i cá»§a báº¡n.';
      return { text };
    }

    // Má»i intent cÃ²n láº¡i â†’ Groq xá»­ lÃ½ thay vÃ¬ fallback cá»©ng
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
    return {
      text: 'Xin chÃ o! TÃ´i lÃ  trá»£ lÃ½ GoPark. TÃ´i cÃ³ thá»ƒ giÃºp báº¡n tÃ¬m bÃ£i Ä‘á»—, Ä‘áº·t chá»—, xem lá»‹ch sá»­, sá»‘ dÆ° vÃ­. Báº¡n cáº§n gÃ¬ áº¡? ðŸ˜Š',
    };
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

  private markdownTable(
    headers: string[],
    rows: Array<Array<string | number>>,
  ): string {
    if (!rows.length) return '_Khong co du lieu phu hop._';
    const header = `| ${headers.join(' | ')} |`;
    const divider = `| ${headers.map(() => '---').join(' | ')} |`;
    const body = rows.map((row) => `| ${row.map((cell) => String(cell)).join(' | ')} |`);
    return [header, divider, ...body].join('\n');
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
      return 'Ban chua co xe trong he thong, hay them xe truoc khi dat.';
    }

    return vehicles
      .map((vehicle: any, index: number) => {
        const type = vehicle.type ? ` (${vehicle.type})` : '';
        return `Xe ${index + 1} la bien so ${vehicle.plate_number}${type}`;
      })
      .join('; ');
  }

  private formatPaymentOptions(): string {
    return 'Thanh toan 1 la VNPAY; thanh toan 2 la vi GoPark; thanh toan 3 la tien mat';
  }

  private formatTimeExamples(): string {
    return 'Ban co the noi ngan gon nhu "hom nay tu 8h den 10h", "ngay mai tu 7h30 den 9h", hoac "luc 14h trong 2 gio"';
  }

  private formatParkingLotOptions(lots: any[]): string {
    if (!lots.length) return 'Hien chua co bai do nao de goi y.';
    return lots
      .slice(0, 5)
      .map((lot: any, index: number) => {
        const address = lot.address ? ` - ${lot.address}` : '';
        const slots = typeof lot.available_slots === 'number' ? `, con ${lot.available_slots} cho` : '';
        return `Bai ${index + 1} la ${lot.name}${address}${slots}`;
      })
      .join('; ');
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
      parkingLotName: lot?.name || pending.parkingLotName,
      vehicleId: vehicle?.id ? String(vehicle.id) : pending.vehicleId,
      vehiclePlate: vehicle?.plate_number || pending.vehiclePlate,
      startTime: times.startTime || pending.startTime,
      endTime: times.endTime || pending.endTime,
      paymentMethod,
      parkingLotOptions: parkingSuggestions.map((suggestion: any) => ({
        id: suggestion.id,
        name: suggestion.name,
        address: suggestion.address,
        available_slots: suggestion.available_slots,
      })),
    };

    const missing: string[] = [];
    if (!nextPending.parkingLotId) missing.push('ten bai do');
    if (!nextPending.startTime || !nextPending.endTime) missing.push('thoi gian vao/ra');
    if (!nextPending.vehiclePlate) missing.push('xe hoac bien so');

    if (missing.length) {
      this.stateService.updateStep(userId, 'awaiting_booking_details', { pendingBooking: nextPending });
      const parkingHint = missing.includes('ten bai do')
        ? `\n${this.formatParkingLotOptions(parkingSuggestions)}. Ban chi can tra loi "bai 1" hoac "bai 2".`
        : '';
      const timeHint = missing.includes('thoi gian vao/ra')
        ? `\n${this.formatTimeExamples()}.`
        : '';
      const vehicleHint = missing.includes('xe hoac bien so')
        ? `\n${this.formatVehicleOptions(vehicles)}. Ban chi can tra loi "xe 1" hoac "xe 2".`
        : '';
      const paymentHint = `\n${this.formatPaymentOptions()}. Neu ban khong chon, minh se de mac dinh VNPAY.`;
      return {
        text: `Minh da ghi nhan ${nextPending.parkingLotName ? `bai ${nextPending.parkingLotName}` : 'yeu cau dat cho'}. Ban cho minh them: ${missing.join(', ')}. Vi du: "bai 1, ngay mai tu 8h den 10h, xe 1, thanh toan 1".${parkingHint}${timeHint}${vehicleHint}${paymentHint}`,
        action: 'collect_booking',
        data: {
          missing,
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
            timeExamples: ['hom nay tu 8h den 10h', 'ngay mai tu 7h30 den 9h', 'luc 14h trong 2 gio'],
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
    if (lastMsg.includes('tÃ¬m bÃ£i') || lastMsg.includes('bÃ£i Ä‘á»—')) {
      const lots = await this.getParkingLotsRaw();
      const top = lots.slice(0, 3);
      let text = 'ðŸ” Káº¿t quáº£ tÃ¬m bÃ£i (cháº¿ Ä‘á»™ dá»± phÃ²ng):\n';
      top.forEach((l, i) => {
        text += `${i + 1}. ${l.name} - ${l.hourly_rate}Ä‘/h (â­${l.avgRating.toFixed(1)})\n`;
      });
      return { text, data: { lots: top, action: 'list_parking' } };
    }
    return {
      text: 'Xin chÃ o! TÃ´i lÃ  trá»£ lÃ½ GoPark. Báº¡n cáº§n tÃ¬m bÃ£i Ä‘á»—, Ä‘áº·t chá»— hay xem lá»‹ch sá»­?',
    };
  }

  async checkModels(): Promise<any> {
    return { groq: { ok: this.groq !== null } };
  }

  // â”€â”€â”€ SESSION MANAGEMENT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async getUserSessions(userId: string): Promise<any> {
    const sessions = await this.sessionRepo.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
      select: ['id', 'title', 'isActive', 'createdAt', 'updatedAt'],
    });
    return sessions;
  }

  async createSession(userId: string, title?: string): Promise<any> {
    const session = this.sessionRepo.create({
      userId,
      title: title || `Cuá»™c trÃ² chuyá»‡n ${new Date().toLocaleDateString('vi-VN')}`,
      messages: [],
      isActive: true,
    });
    return this.sessionRepo.save(session);
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
