import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, In, Like } from 'typeorm';
import {
  ChatbotIntent,
  classifyIntent,
  extractParkingName,
} from './Chatbot.intent';
import { ParkingLot } from '../parking-lot/entities/parking-lot.entity';
import { Booking } from '../booking/entities/booking.entity';
import { ChatbotStateService, ChatSession } from './chatbot-state.service';

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);
  private readonly groqApiKey: string;
  private sessions: Map<string, any[]> = new Map();

  constructor(
    private readonly dataSource: DataSource,
    private readonly stateService: ChatbotStateService,
  ) {
    this.groqApiKey =
      process.env.GROQ_API_KEY || process.env.GORQ_API_KEY || '';
    if (!this.groqApiKey) {
      this.logger.warn('GROQ_API_KEY is not set');
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

  async processMessage(
    messages: any[],
    userId?: string,
  ): Promise<{ text: string; action?: string; data?: any }> {
    const lastMessage = this.extractLastUserMessage(messages);
    const intent = classifyIntent(lastMessage);
    this.logger.log(
      `Intent: ${intent} | Msg: ${lastMessage} | UserId: ${userId || 'anonymous'}`,
    );

    if (
      userId &&
      (intent === ChatbotIntent.FIND_NEARBY ||
        intent === ChatbotIntent.FIND_BEST)
    ) {
      const existing = this.stateService.getSession(userId);
      if (existing && existing.step !== 'idle') {
        this.logger.log(
          `Clearing old session (${existing.step}) for user ${userId} due to search intent`,
        );
        this.stateService.deleteSession(userId);
      }
    }
    // 1. Kiểm tra nếu có session đang chờ
    if (userId) {
      const session = this.stateService.getSession(userId);
      if (session && session.step !== 'idle') {
        return this.handleOngoingSession(userId, lastMessage, session);
      }
    }

    // 2. Xử lý các intent đặc biệt
    if (
      intent === ChatbotIntent.FIND_BEST ||
      intent === ChatbotIntent.FIND_NEARBY
    ) {
      return this.handleFindParking(lastMessage, intent, userId);
    }
    if (intent === ChatbotIntent.BOOK_PARKING) {
      return this.handleBookingRequest(lastMessage, userId);
    }

    // Thêm intent VIEW_PARKING_DETAIL
    if (intent === (ChatbotIntent as any).VIEW_PARKING_DETAIL) {
      return this.handleViewParkingDetail(lastMessage);
    }

    // 3. Các intent tĩnh hoặc một bước
    return this.handleSimpleIntent(intent, lastMessage, userId);
  }

  private async handleCriteriaResponse(
    userId: string,
    message: string,
    session: ChatSession,
  ): Promise<{ text: string; action?: string; data?: any }> {
    const criteria = this.parseCriteria(message);
    if (!criteria) {
      return {
        text: '❓ Tôi chưa hiểu tiêu chí của bạn. Vui lòng chọn:\n1 - Giá thấp nhất\n2 - Khoảng cách gần nhất\n3 - Cả hai (tối ưu)',
      };
    }

    let sorted: any[] = [];
    if (criteria === 'price') {
      sorted = await this.getParkingLotsSorted('hourly_rate');
    } else if (criteria === 'distance') {
      sorted = await this.getParkingLotsSorted('distance');
    } else {
      const lots = await this.getParkingLotsSorted('hourly_rate');
      sorted = [...lots].sort((a, b) => {
        const priceA = Number((a as any).hourly_rate || 20000);
        const priceB = Number((b as any).hourly_rate || 20000);
        const scoreA =
          a.avgRating * 0.5 +
          (1 / (priceA + 1)) * 0.3 +
          a.available_slots * 0.2;
        const scoreB =
          b.avgRating * 0.5 +
          (1 / (priceB + 1)) * 0.3 +
          b.available_slots * 0.2;
        return scoreB - scoreA;
      });
    }

    const top2 = sorted.slice(0, 2);
    if (top2.length === 0) {
      return {
        text: 'Rất tiếc, không tìm thấy bãi phù hợp với tiêu chí của bạn.',
      };
    }

    // Lưu session để chọn bãi
    this.stateService.updateStep(userId, 'awaiting_parking_selection', {
      suggestedLots: top2,
      intent: 'FIND_BEST',
      criteria,
    });

    let text = `🏆 **Bãi đỗ tốt nhất theo tiêu chí ${criteria === 'price' ? 'giá thấp' : criteria === 'distance' ? 'khoảng cách' : 'tổng hợp'}:**\n\n`;
    top2.forEach((lot, idx) => {
      const priceText = (lot as any).hourly_rate
        ? `${(lot as any).hourly_rate.toLocaleString()}đ/h`
        : 'Liên hệ';
      text += `${idx + 1}. **${lot.name}** – ${lot.address}\n   ⭐ ${lot.avgRating.toFixed(1)} · 💰 ${priceText} · 🅿️ Còn ${lot.available_slots}/${lot.total_slots} chỗ\n`;
    });
    text +=
      '\n💬 **Hãy trả lời số thứ tự** để đặt chỗ hoặc "xem chi tiết [tên]" để xem thêm.';

    return { text, data: { lots: top2, action: 'list_parking' } };
  }

  private parseCriteria(message: string): 'price' | 'distance' | 'both' | null {
    const lower = message.toLowerCase();
    if (lower.includes('1') || lower.includes('giá') || lower.includes('thấp'))
      return 'price';
    if (
      lower.includes('2') ||
      lower.includes('khoảng cách') ||
      lower.includes('gần')
    )
      return 'distance';
    if (lower.includes('3') || lower.includes('cả') || lower.includes('hai'))
      return 'both';
    return null;
  }

  private async handleSimpleIntent(
    intent: ChatbotIntent,
    message: string,
    userId?: string,
  ): Promise<{ text: string; action?: string; data?: any }> {
    // Static responses
    if (this.isStaticIntent(intent)) {
      return { text: this.getStaticResponse(intent) };
    }

    if (intent === ChatbotIntent.CHECK_WALLET) {
      if (!userId)
        return { text: this.buildLoginRequiredResponse('xem số dư ví') };
      return { text: await this.getWalletData(userId) };
    }
    if (intent === ChatbotIntent.CHECK_BOOKING) {
      if (!userId)
        return { text: this.buildLoginRequiredResponse('xem lịch sử đặt chỗ') };
      return { text: await this.getBookingData(userId) };
    }
    if (intent === ChatbotIntent.CANCEL_BOOKING) {
      if (!userId)
        return { text: this.buildLoginRequiredResponse('hủy đặt chỗ') };
      return { text: await this.getCancellableBookingData(userId) };
    }
    if (intent === ChatbotIntent.BOOK_PARKING) {
      return { text: this.getBookingGuide() };
    }
    if (intent === ChatbotIntent.CHECK_INVOICE) {
      if (!userId)
        return { text: this.buildLoginRequiredResponse('xem hóa đơn') };
      return { text: await this.getInvoiceData(userId) };
    }
    return { text: this.getFallbackResponse() };
  }

  private async handleFindParking(
    message: string,
    intent: ChatbotIntent,
    userId?: string,
  ) {
    if (intent === ChatbotIntent.FIND_BEST) {
      // Hỏi tiêu chí
      if (userId) {
        this.stateService.setSession(userId, {
          step: 'awaiting_criteria',
          context: { intent: 'FIND_BEST' },
          updatedAt: Date.now(),
        });
      }
      return {
        text: 'Bạn muốn tìm bãi đỗ tốt nhất dựa trên tiêu chí nào?\n\n1️⃣ **Giá thấp nhất**\n2️⃣ **Khoảng cách gần nhất**\n3️⃣ **Cả giá và khoảng cách**\n\n👉 Hãy trả lời số (1,2,3) hoặc mô tả (ví dụ: "giá thấp", "gần nhất", "cả hai").',
      };
    }

    // FIND_NEARBY: lấy danh sách bãi
    const lots = await this.getParkingLotsRaw();
    if (lots.length === 0) {
      return {
        text: 'Hiện tại không có bãi đỗ nào đang hoạt động. Vui lòng thử lại sau.',
      };
    }

    // Sắp xếp theo số chỗ trống giảm dần (hiển thị bãi còn nhiều chỗ trước)
    const sorted = [...lots].sort(
      (a, b) => b.available_slots - a.available_slots,
    );
    const top5 = sorted.slice(0, 5);

    // Lưu session để sau này chọn bãi
    if (userId) {
      this.stateService.updateStep(userId, 'awaiting_parking_selection', {
        suggestedLots: top5,
        intent: 'FIND_NEARBY',
      });
    }

    let text = '📍 **Các bãi đỗ gần bạn nhất:**\n\n';
    top5.forEach((lot, idx) => {
      const priceText = (lot as any).pricePerHour
        ? `${(lot as any).pricePerHour.toLocaleString()}đ/h`
        : 'Liên hệ';
      text += `${idx + 1}. **${lot.name}**\n   📍 ${lot.address}\n   ⭐ ${lot.avgRating.toFixed(1)} · 💰 ${priceText} · 🅿️ Còn ${lot.available_slots}/${lot.total_slots} chỗ\n`;
    });
    text +=
      '\n💬 **Hãy trả lời số thứ tự** (ví dụ: "1") hoặc **tên bãi** để đặt chỗ.\n📖 Hoặc nói "xem chi tiết [tên bãi]" để xem thông tin chi tiết.';

    return {
      text,
      data: { lots: top5, action: 'list_parking' },
      quickReplies: top5
        .map((lot, idx) => `Đặt bãi ${idx + 1}`)
        .concat(['Xem chi tiết', 'Tìm bãi khác']),
    };
  }

  private async handleBookingRequest(message: string, userId?: string) {
    if (!userId) {
      return {
        text: '🔐 Bạn cần đăng nhập để đặt bãi. Vui lòng đăng nhập và thử lại.',
      };
    }

    // Trích xuất tên bãi từ câu nói "đặt bãi X"
    const parkingName = extractParkingName(message);
    let parkingLot: any = null;

    if (parkingName) {
      parkingLot = await this.findParkingByName(parkingName);
    }

    if (!parkingLot) {
      // Chưa có bãi -> hỏi chọn bãi
      const lots = await this.getParkingLotsRaw();
      this.stateService.updateStep(userId, 'awaiting_parking_selection', {
        suggestedLots: lots.slice(0, 5),
      });
      const listText = lots
        .slice(0, 5)
        .map((l, i) => `${i + 1}. ${l.name}`)
        .join('\n');
      return {
        text: `Bạn muốn đặt bãi nào?\n${listText}\n\nVui lòng nhập số thứ tự hoặc tên bãi.`,
      };
    }

    // Đã có bãi -> lưu vào session và hỏi thời gian
    this.stateService.updateStep(userId, 'awaiting_booking_details', {
      selectedLotId: parkingLot.id,
      selectedLotName: parkingLot.name,
      selectedLotAddress: parkingLot.address,
    });
    return {
      text: `Bạn đã chọn bãi **${parkingLot.name}**.\n📍 ${parkingLot.address}\n\nVui lòng cho tôi biết **thời gian bắt đầu** (ví dụ: 10h15 ngày 20/5) và **thời gian kết thúc**.`,
    };
  }

  private async findParkingByName(name: string): Promise<ParkingLot | null> {
    const repo = this.dataSource.getRepository(ParkingLot);
    return repo.findOne({
      where: { name: Like(`%${name}%`), status: 'ACTIVE' },
    });
  }

  private async handleViewParkingDetail(message: string): Promise<any> {
    const name = extractParkingName(message);
    if (!name) {
      return {
        text: 'Vui lòng cho tôi biết tên bãi đỗ bạn muốn xem chi tiết.',
      };
    }
    const lot = await this.findParkingByName(name);
    if (!lot) return { text: 'Không tìm thấy bãi đỗ với tên đó.' };
    return {
      text: `Chuyển đến trang chi tiết ${lot.name}...`,
      action: 'redirect',
      data: { url: `/users/detailParking/${lot.id}` },
    };
  }

  private async handleOngoingSession(
    userId: string,
    message: string,
    session: ChatSession,
  ): Promise<{ text: string; action?: string; data?: any }> {
    const intent = classifyIntent(message);
    if (
      intent === ChatbotIntent.FIND_NEARBY ||
      intent === ChatbotIntent.FIND_BEST
    ) {
      this.logger.log(
        `Ongoing session but user asks to find parking, resetting session for ${userId}`,
      );
      this.stateService.deleteSession(userId);
      return this.handleFindParking(message, intent, userId);
    }
    if (session.step === 'awaiting_criteria') {
      return this.handleCriteriaResponse(userId, message, session);
    }
    const step = session.step;
    const context = session.context;

    // Bước 1: Chọn bãi từ danh sách gợi ý
    if (step === 'awaiting_parking_selection') {
      const lots = context.suggestedLots;
      let selected: any = null;
      const num = parseInt(message);
      if (!isNaN(num) && num >= 1 && num <= lots.length) {
        selected = lots[num - 1];
      } else {
        selected = lots.find((l: any) =>
          l.name.toLowerCase().includes(message.toLowerCase()),
        );
      }
      if (!selected) {
        // Tạo lại danh sách text để hiển thị lại
        const lotListText = lots
          .map((l: any, i: number) => `${i + 1}. ${l.name}`)
          .join('\n');
        return {
          text: `❌ Không tìm thấy bãi "${message}". Vui lòng chọn số thứ tự hoặc tên chính xác trong danh sách:\n${lotListText}\n\nVí dụ: nhập "1" hoặc "${lots[0]?.name}"`,
        };
      }
      this.stateService.updateStep(userId, 'awaiting_booking_details', {
        selectedLotId: selected.id,
        selectedLotName: selected.name,
        selectedLotAddress: selected.address,
      });
      return {
        text: `Bạn đã chọn **${selected.name}**.\n📍 ${selected.address}\n\nVui lòng cho biết thời gian bắt đầu và kết thúc (vd: 10h15 20/5 đến 12h30 20/5).`,
      };
    }

    // Bước 2: Nhập thời gian
    if (
      step === 'awaiting_booking_details' &&
      (!context.startTime || !context.endTime)
    ) {
      const { start, end } = this.parseTimeRange(message);

      // Trích xuất biển số xe nếu có
      const plateMatch = message.match(/(\d{2}[A-Z]\d{4,5})/);
      const extractedPlate = plateMatch ? plateMatch[1] : null;

      if (!start || !end) {
        return {
          text: 'Tôi chưa rõ thời gian. Hãy nhập rõ hơn, ví dụ: "từ 10h15 đến 11h30 ngày 20/5".',
        };
      }

      // Lưu thời gian và hỏi xe
      const vehicles = await this.dataSource.query(
        `SELECT id, plate_number, vehicle_type FROM vehicles WHERE user_id = $1`,
        [userId],
      );

      if (vehicles.length === 0) {
        return {
          text: 'Bạn chưa có xe nào trong hệ thống. Vui lòng thêm xe tại trang Cá nhân trước khi đặt.',
        };
      }

      const vehicleList = vehicles
        .map(
          (v: any, i: number) =>
            `${i + 1}. ${v.plate_number} (${v.vehicle_type})`,
        )
        .join('\n');

      this.stateService.updateStep(userId, 'awaiting_booking_details', {
        ...context,
        startTime: start,
        endTime: end,
        tempVehicles: vehicles,
        extractedPlate: extractedPlate,
      });

      // Nếu đã có biển số từ đầu, tự động chọn xe
      if (extractedPlate) {
        const matchedVehicle = vehicles.find(
          (v: any) => v.plate_number === extractedPlate,
        );
        if (matchedVehicle) {
          this.stateService.updateStep(userId, 'awaiting_booking_details', {
            ...context,
            startTime: start,
            endTime: end,
            vehicleId: matchedVehicle.id,
            tempVehicles: vehicles,
          });
          return {
            text: `Thời gian đã ghi nhận.\n🚗 Đã nhận diện xe ${matchedVehicle.plate_number}.\n\n💳 Vui lòng chọn phương thức thanh toán:\n1. Ví GoPark\n2. VNPay\n3. Thanh toán khi nhận xe\n\nNhập số tương ứng.`,
          };
        }
      }

      return {
        text: `Thời gian đã ghi nhận.\n🚗 Vui lòng chọn xe của bạn:\n${vehicleList}\nNhập số thứ tự.`,
      };
    }

    // Bước 3: Chọn xe
    if (
      step === 'awaiting_booking_details' &&
      context.startTime &&
      context.endTime &&
      !context.vehicleId
    ) {
      const num = parseInt(message);
      const vehicles = context.tempVehicles;
      if (isNaN(num) || num < 1 || num > vehicles.length) {
        return { text: 'Vui lòng nhập số thứ tự hợp lệ.' };
      }
      const selectedVehicle = vehicles[num - 1];
      this.stateService.updateStep(userId, 'awaiting_booking_details', {
        ...context,
        vehicleId: selectedVehicle.id,
      });
      return {
        text: `Đã chọn xe ${selectedVehicle.plate_number}.\n💳 Vui lòng chọn phương thức thanh toán:\n1. Ví GoPark\n2. VNPay\n3. Thanh toán khi nhận xe\n\nNhập số tương ứng.`,
      };
    }

    // Bước 4: Chọn phương thức thanh toán -> redirect sang trang đặt
    if (
      step === 'awaiting_booking_details' &&
      context.vehicleId &&
      !context.paymentMethod
    ) {
      const methodMap: Record<string, string> = {
        '1': 'WALLET',
        '2': 'VNPAY',
        '3': 'CASH',
      };
      const selectedMethod = methodMap[message.trim()];
      if (!selectedMethod) {
        return {
          text: 'Vui lòng chọn phương thức thanh toán hợp lệ (1, 2 hoặc 3).',
        };
      }

      // Redirect sang trang đặt bãi với đầy đủ thông tin
      const startTimeParam = encodeURIComponent(
        context.startTime.toISOString(),
      );
      const endTimeParam = encodeURIComponent(context.endTime.toISOString());
      const url = `/users/mybooking/${context.selectedLotId}?start=${startTimeParam}&end=${endTimeParam}&vehicle=${context.vehicleId}&payment=${selectedMethod}`;

      this.stateService.deleteSession(userId);

      return {
        text: `✅ Đã ghi nhận thông tin!\n\n⏰ Thời gian: ${context.startTime.toLocaleString('vi-VN')} - ${context.endTime.toLocaleString('vi-VN')}\n🚗 Xe: đã chọn\n💳 Thanh toán: ${selectedMethod}\n\nChuyển sang trang đặt bãi...`,
        action: 'redirect',
        data: { url },
      };
    }

    return { text: 'Có lỗi trong quá trình xử lý. Vui lòng bắt đầu lại.' };
  }

  private async getParkingLotsRaw(): Promise<
    (ParkingLot & { avgRating: number; hourly_rate: number })[]
  > {
    const lots = await this.dataSource.getRepository(ParkingLot).find({
      where: { status: 'ACTIVE' },
      relations: ['review', 'parkingFloor', 'parkingFloor.parkingZones', 'parkingFloor.parkingZones.pricingRule'],
      take: 20,
    });
    return lots.map((lot: any) => {
      let avgRating = 0;
      if (lot.review?.length) {
        avgRating =
          lot.review.reduce((s: number, r: any) => s + (r.rating || 0), 0) /
          lot.review.length;
      }
      // Lấy giá từ pricing rule, nếu không có dùng giá mặc định
      let hourly_rate = 20000;
      if (lot.parkingFloor?.length > 0) {
        for (const floor of lot.parkingFloor) {
          if (floor.parkingZones?.length > 0) {
            for (const zone of floor.parkingZones) {
              if (zone.pricingRule?.length > 0) {
                hourly_rate = zone.pricingRule[0]?.price_per_hour || 20000;
                break;
              }
            }
            if (hourly_rate !== 20000) break;
          }
        }
      }
      return { ...lot, avgRating, hourly_rate };
    });
  }

  private async getParkingLotsSorted(orderBy: string): Promise<any[]> {
    const lots = await this.getParkingLotsRaw();
    if (orderBy === 'hourly_rate') {
      lots.sort(
        (a, b) => ((a as any).hourly_rate || 20000) - ((b as any).hourly_rate || 20000),
      );
    } else if (orderBy === 'rating') {
      lots.sort((a, b) => b.avgRating - a.avgRating);
    } else if (orderBy === 'distance') {
      // Mặc định sắp xếp theo available slots
      lots.sort((a, b) => b.available_slots - a.available_slots);
    }
    return lots.slice(0, 5);
  }

  private formatLotList(lots: any[]): string {
    let text = '📋 **Danh sách bãi đỗ:**\n\n';
    lots.forEach((lot, idx) => {
      text += `${idx + 1}. **${lot.name}** – ${lot.address}\n   ⭐ ${lot.avgRating.toFixed(1)} · 🅿️ ${lot.available_slots}/${lot.total_slots}\n`;
    });
    text += '\n💬 Hãy nhập số thứ tự hoặc tên bãi để đặt chỗ.';
    return text;
  }

  private async createBookingFromSession(
    userId: string,
    session: any,
  ): Promise<any> {
    const { selectedLotId, startTime, endTime, vehicleId, paymentMethod } =
      session.context;

    const lot = await this.dataSource
      .getRepository(ParkingLot)
      .findOne({ where: { id: selectedLotId } });
    const hours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
    const DEFAULT_HOURLY_RATE = 20000;
    const totalAmount = Math.ceil(hours) * DEFAULT_HOURLY_RATE;

    const newBooking = await this.dataSource.transaction(async (manager) => {
      const slot = await manager.query(
        `SELECT * FROM slots WHERE parking_lot_id = $1 AND is_available = true LIMIT 1`,
        [selectedLotId],
      );
      if (!slot.length) throw new Error('Hết chỗ trống');

      const booking = await manager.query(
        `INSERT INTO bookings (user_id, slot_id, vehicle_id, start_time, end_time, total_amount, payment_method, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', NOW()) RETURNING *`,
        [
          userId,
          slot[0].id,
          vehicleId,
          startTime,
          endTime,
          totalAmount,
          paymentMethod,
        ],
      );

      await manager.query(
        `UPDATE slots SET is_available = false WHERE id = $1`,
        [slot[0].id],
      );
      return booking[0];
    });
    return newBooking;
  }

  private parseTimeRange(input: string): {
    start: Date | null;
    end: Date | null;
  } {
    const patterns = [
      /từ\s+(\d{1,2})[:h](\d{2})\s*(?:ngày\s*)?(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s+đến\s+(\d{1,2})[:h](\d{2})\s*(?:ngày\s*)?(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/i,
      /(\d{1,2})[:h](\d{2})\s+(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})[:h](\d{2})\s+(\d{1,2})\/(\d{1,2})/i,
    ];
    for (const regex of patterns) {
      const match = input.match(regex);
      if (match) {
        const parse = (
          h: number,
          m: number,
          d: number,
          mon: number,
          yr?: number,
        ) => new Date(yr || new Date().getFullYear(), mon - 1, d, h, m);
        const start = parse(
          parseInt(match[1]),
          parseInt(match[2]),
          parseInt(match[3]),
          parseInt(match[4]),
          match[5] ? parseInt(match[5]) : undefined,
        );
        const end = parse(
          parseInt(match[6]),
          parseInt(match[7]),
          parseInt(match[8]),
          parseInt(match[9]),
          match[10] ? parseInt(match[10]) : undefined,
        );
        return { start, end };
      }
    }
    return { start: null, end: null };
  }

  private async getParkingLotsData(intent: ChatbotIntent): Promise<string> {
    try {
      const parkingLotRepo = this.dataSource.getRepository(ParkingLot);
      const lots = await parkingLotRepo.find({
        where: { status: 'ACTIVE' },
        relations: ['review'],
        take: 10,
      });

      if (lots.length === 0) {
        return '📋 Hiện tại không có bãi đỗ xe nào đang hoạt động trong hệ thống.';
      }

      const lotsWithRating = lots.map((lot) => {
        let avgRating = 0;
        if (lot.review && lot.review.length > 0) {
          const sum = lot.review.reduce((acc, r) => acc + (r.rating || 0), 0);
          avgRating = sum / lot.review.length;
        }
        return { ...lot, avgRating };
      });

      if (intent === ChatbotIntent.FIND_BEST) {
        lotsWithRating.sort((a, b) => b.avgRating - a.avgRating);
      } else {
        lotsWithRating.sort((a, b) => b.available_slots - a.available_slots);
      }

      const topLots = lotsWithRating.slice(0, 5);
      let result =
        intent === ChatbotIntent.FIND_BEST
          ? '🏆 **Bãi đỗ được đánh giá tốt nhất:**\n\n'
          : '📍 **Danh sách bãi đỗ đang hoạt động:**\n\n';

      for (let i = 0; i < topLots.length; i++) {
        const lot = topLots[i];
        result += `${i + 1}. **${lot.name}**\n`;
        result += `   📍 Địa chỉ: ${lot.address}\n`;
        result += `   🅿️ Chỗ trống: ${lot.available_slots}/${lot.total_slots}\n`;
        result += `   ⭐ Đánh giá: ${lot.avgRating.toFixed(1)}/5\n\n`;
      }
      result += `\n💡 *Để đặt chỗ, vui lòng nói "đặt bãi [tên bãi]"*`;
      return result;
    } catch (error) {
      this.logger.error('Error getting parking lots:', error);
      return '❌ Có lỗi xảy ra khi lấy danh sách bãi đỗ.';
    }
  }

  private async getBookingData(userId: string): Promise<string> {
    try {
      const bookingRepo = this.dataSource.getRepository(Booking);
      const bookings = await bookingRepo.find({
        where: { user: { id: userId } },
        relations: [
          'slot',
          'slot.parkingZone',
          'slot.parkingZone.parkingFloor',
          'slot.parkingZone.parkingFloor.parkingLot',
          'vehicle',
        ],
        order: { created_at: 'DESC' },
        take: 5,
      });

      if (bookings.length === 0) {
        return '📋 Bạn chưa có lịch sử đặt chỗ nào.\n\n💡 Hãy thử nói "tìm bãi đỗ gần tôi" để bắt đầu đặt chỗ!';
      }

      let result = '📋 **LỊCH SỬ ĐẶT CHỖ CỦA BẠN:**\n\n';
      for (let i = 0; i < bookings.length; i++) {
        const b = bookings[i];
        const lotName =
          b.slot?.parkingZone?.parkingFloor?.parkingLot?.name || 'N/A';
        const startTime = new Date(b.start_time).toLocaleString('vi-VN');
        result += `${i + 1}. **${lotName}**\n`;
        result += `   📅 Thời gian: ${startTime}\n`;
        result += `   🚗 Biển số: ${b.vehicle?.plate_number || 'N/A'}\n`;
        result += `   📊 Trạng thái: ${this.getStatusText(b.status)}\n\n`;
      }
      return result;
    } catch (error) {
      this.logger.error('Error getting bookings:', error);
      return '❌ Có lỗi xảy ra khi lấy lịch sử đặt chỗ.';
    }
  }

  private async getCancellableBookingData(userId: string): Promise<string> {
    try {
      const bookingRepo = this.dataSource.getRepository(Booking);
      const bookings = await bookingRepo.find({
        where: { user: { id: userId }, status: In(['PENDING', 'CONFIRMED']) },
        relations: [
          'slot',
          'slot.parkingZone',
          'slot.parkingZone.parkingFloor',
          'slot.parkingZone.parkingFloor.parkingLot',
        ],
        order: { start_time: 'ASC' },
      });

      if (bookings.length === 0) {
        return '📋 Bạn không có booking nào có thể hủy.\n\n💡 Chỉ có thể hủy booking ở trạng thái PENDING hoặc CONFIRMED.';
      }

      let result = '🔧 **CÁC BOOKING CÓ THỂ HỦY:**\n\n';
      for (let i = 0; i < bookings.length; i++) {
        const b = bookings[i];
        const lotName =
          b.slot?.parkingZone?.parkingFloor?.parkingLot?.name || 'N/A';
        const startTime = new Date(b.start_time).toLocaleString('vi-VN');
        result += `${i + 1}. **${lotName}**\n`;
        result += `   📅 Thời gian: ${startTime}\n`;
        result += `   📊 Trạng thái: ${this.getStatusText(b.status)}\n`;
        result += `   🆔 Mã booking: ${b.id}\n\n`;
      }
      result += `\n💡 *Để hủy booking, vui lòng nói "hủy booking [mã booking]"*`;
      return result;
    } catch (error) {
      this.logger.error('Error getting cancellable bookings:', error);
      return '❌ Có lỗi xảy ra khi lấy danh sách booking.';
    }
  }

  private async getWalletData(userId: string): Promise<string> {
    try {
      const wallet = await this.dataSource
        .createQueryBuilder()
        .select('*')
        .from('wallets', 'w')
        .where('w.user_id = :userId', { userId })
        .getRawOne();

      if (!wallet) {
        return '💰 Bạn chưa có ví GoPark.\n\n💡 Vào mục Ví trong ứng dụng để tạo ví và nạp tiền nhé!';
      }
      const balance = Number(wallet.balance) || 0;
      return `💰 **Số dư ví GoPark của bạn:** ${balance.toLocaleString('vi-VN')}đ`;
    } catch (error) {
      this.logger.error('Error getting wallet:', error);
      return '❌ Có lỗi xảy ra khi lấy số dư ví.';
    }
  }

  private async getInvoiceData(userId: string): Promise<string> {
    try {
      const invoices = await this.dataSource
        .createQueryBuilder()
        .select('*')
        .from('invoices', 'inv')
        .where('inv.user_id = :userId', { userId })
        .orderBy('inv.created_at', 'DESC')
        .limit(5)
        .getRawMany();

      if (!invoices || invoices.length === 0) {
        return '📋 Bạn chưa có hóa đơn nào.';
      }

      let result = '📋 **DANH SÁCH HÓA ĐƠN:**\n\n';
      for (let i = 0; i < invoices.length; i++) {
        const inv = invoices[i];
        result += `${i + 1}. Hóa đơn #${inv.id}\n`;
        result += `   💰 Số tiền: ${Number(inv.amount).toLocaleString('vi-VN')}đ\n`;
        result += `   📊 Trạng thái: ${inv.status === 'PAID' ? 'Đã thanh toán' : inv.status}\n\n`;
      }
      return result;
    } catch (error) {
      return '📋 Hiện tại chưa có hóa đơn nào.';
    }
  }

  private isStaticIntent(intent: ChatbotIntent): boolean {
    return [
      ChatbotIntent.CONTACT,
      ChatbotIntent.PAYMENT_GUIDE,
      ChatbotIntent.OWNER_FEATURE,
      ChatbotIntent.PROMOTION,
      ChatbotIntent.OPENING_HOURS,
    ].includes(intent);
  }

  private getStaticResponse(intent: ChatbotIntent): string {
    const responses: Partial<Record<ChatbotIntent, string>> = {
      [ChatbotIntent.CONTACT]: `📞 **Liên hệ hỗ trợ GoPark**\n\n- **Hotline**: 1800-GOPARK\n- **Email**: support@gopark.id.vn`,
      [ChatbotIntent.PAYMENT_GUIDE]: `💳 **Hướng dẫn thanh toán**\n\n1. Ví GoPark\n2. VNPay\n3. Thanh toán khi nhận xe`,
      [ChatbotIntent.OWNER_FEATURE]: `🏢 **Tính năng chủ bãi**\n\n1. Đăng ký bãi\n2. Quản lý giá\n3. Báo cáo doanh thu`,
      [ChatbotIntent.PROMOTION]: `🎁 Hiện tại chưa có khuyến mãi.`,
      [ChatbotIntent.OPENING_HOURS]: `🕐 GoPark hoạt động **24/7**.`,
    };
    return responses[intent] || 'Tôi có thể giúp gì cho bạn?';
  }

  private getBookingGuide(): string {
    return `📝 **Hướng dẫn đặt bãi:**\n\n1. Nói "tìm bãi đỗ gần tôi"\n2. Chọn bãi bạn muốn\n3. Nói "đặt bãi [tên bãi]"`;
  }

  private getFallbackResponse(): string {
    return `Xin chào! Tôi có thể giúp bạn:\n\n🔹 Tìm bãi đỗ - "tìm bãi gần tôi"\n🔹 Xem lịch sử đặt - "xem booking"\n🔹 Xem số dư ví - "số dư ví"\n🔹 Hủy đặt chỗ - "hủy booking"`;
  }

  private getStatusText(status: string): string {
    const map: Record<string, string> = {
      PENDING: '⏳ Chờ xác nhận',
      CONFIRMED: '✅ Đã xác nhận',
      COMPLETED: '✔️ Hoàn thành',
      CANCELLED: '❌ Đã hủy',
    };
    return map[status] || status;
  }

  private buildLoginRequiredResponse(action: string): string {
    return `🔐 Để ${action}, bạn cần đăng nhập trước.`;
  }

  private extractLastUserMessage(messages: any[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'user') {
        return String(messages[i].content || '');
      }
    }
    return '';
  }

  async streamToResponse(messages: any[], res: any, userId?: string) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const result = await this.processMessage(messages, userId);
      res.write(
        `data: ${JSON.stringify({ text: result.text, action: result.action, data: result.data })}\n\n`,
      );
    } catch (err) {
      res.write(
        `event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`,
      );
    } finally {
      res.write('event: done\ndata: {}\n\n');
      res.end();
    }
  }

  async checkModels(): Promise<any> {
    return { groq: { ok: true } };
  }
}
