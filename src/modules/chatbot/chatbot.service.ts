// chatbot.service.ts - thay toàn bộ nội dung (hoặc merge các phần sửa)

import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import Groq from 'groq-sdk';
import { ParkingLot } from '../parking-lot/entities/parking-lot.entity';
import { ChatbotStateService } from './chatbot-state.service';
import { classifyIntent, requiresData, INTENT_DB_CONFIG, extractParkingName, ChatbotIntent } from './Chatbot.intent';

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);
  private groq: Groq | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly stateService: ChatbotStateService, // ✅ thêm state
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
    // Lấy câu cuối của người dùng
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || '';
    const intent = classifyIntent(lastUserMessage);
    this.logger.log(`Intent: ${intent} | Message: ${lastUserMessage}`);
    const session = userId ? this.stateService.getSession(userId) : undefined;
    const sessionContext = session?.context ?? {};
    const sessionPendingBooking = sessionContext.pendingBooking ?? {};

    // ----- XỬ LÝ CÁC INTENT CẦN DATA -----
    if (requiresData(intent) && INTENT_DB_CONFIG[intent]) {
      const config = INTENT_DB_CONFIG[intent];
      // Kiểm tra đăng nhập nếu cần
      if (config.requiresUserId && !userId) {
        return { text: '⚠️ Vui lòng đăng nhập để sử dụng tính năng này.' };
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
                ? `📍 Tìm thấy ${result.lots.length} bãi gần bạn nhất (có khoảng cách).`
                : `📍 Đây là ${result.lots.length} bãi đỗ còn nhiều chỗ trống nhất hiện tại.`,
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
                text: `💰 Top ${result.lots.length} bãi giá rẻ nhất hiện có (sắp xếp theo giá/giờ tăng dần):`,
                action: 'list_parking',
                data: { lots: result.lots, action: 'list_parking', criteria: 'price_cheapest' },
              };
            }
            const top = result.lots[0];
            return {
              text: `⭐ Bãi phù hợp nhất: **${top.name}**\n\n📊 Tiêu chí:\n• Đánh giá: ${Number(top.avgRating || 0).toFixed(1)} ⭐ (40%)\n• Chỗ trống: ${top.available_slots}/${top.total_slots} (30%)\n• Giá: ${(top.hourly_rate || 20000).toLocaleString('vi-VN')}đ/giờ (30%)`,
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
          if (bookings.length === 0) return { text: '📋 Bạn chưa có đặt chỗ nào.' };
          let text = `📋 Lịch sử đặt chỗ của bạn:\n`;
          bookings.forEach((b: any, i: number) => {
            text += `${i+1}. ${b.lot_name} | ${new Date(b.start_time).toLocaleString()} → ${new Date(b.end_time).toLocaleString()} | ${b.status}\n`;
          });
          return { text };
        }

        case ChatbotIntent.CHECK_WALLET: {
          const data = await this.getWalletBalance(userId);
          if (data.error) return { text: data.error };
          const balance = data.balance || 0;
          return { text: `💰 Số dư ví GoPark của bạn: ${balance.toLocaleString('vi-VN')}đ.` };
        }

        case ChatbotIntent.CHECK_VEHICLES: {
          const data = await this.getUserVehicles(userId);
          if (data.error) return { text: data.error };
          const vehicles = data.vehicles || [];
          if (vehicles.length === 0) return { text: '🚗 Bạn chưa đăng ký xe nào. Vào mục "Xe của tôi" để thêm xe.' };
          let text = `🚗 Danh sách xe đã đăng ký:\n`;
          vehicles.forEach((v: any, i: number) => {
            text += `${i+1}. ${v.plate_number} (${v.type || 'Xe hơi'})\n`;
          });
          return { text };
        }

        case ChatbotIntent.CHECK_INVOICE:
          return { text: '📄 Tính năng xem hóa đơn đang được phát triển. Bạn có thể xem trong trang Cá nhân.' };

        case ChatbotIntent.CANCEL_BOOKING:
          return { text: '❓ Vui lòng cung cấp mã đặt chỗ (ID) bạn muốn hủy.' };

        default:
          // Các intent khác (nếu có) sẽ rơi vào đây
          break;
      }
    }

    // ----- XỬ LÝ ĐẶT BÃI (BOOK_PARKING / BOOK_WITH_DETAILS) -----
    if (intent === ChatbotIntent.BOOK_PARKING || intent === ChatbotIntent.BOOK_WITH_DETAILS) {
      if (!userId) {
        return { text: '⚠️ Bạn cần đăng nhập để đặt bãi. Vui lòng đăng nhập để tiếp tục đặt chỗ.' };
      }

      // Nếu là câu hỏi hướng dẫn → dùng Groq
      const msgLower = lastUserMessage.toLowerCase();
      if (
        msgLower.includes('cách') || msgLower.includes('như thế nào') ||
        msgLower.includes('hướng dẫn') || msgLower.includes('làm sao') ||
        msgLower.includes('bước') || msgLower.includes('quy trình')
      ) {
        if (this.groq) {
          const resp = await this.groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'system', content: this.getSystemPrompt() }, ...messages.slice(-4)] as any,
            temperature: 0.7,
          });
          return { text: resp.choices[0].message.content || 'Vui lòng chọn bãi đỗ, sau đó nhấn "Đặt ngay" để tiến hành đặt chỗ.' };
        }
        return { text: '📋 Để đặt bãi:\n1. Tìm bãi phù hợp\n2. Nhấn "Đặt ngay"\n3. Chọn thời gian, xe, phương thức thanh toán\n4. Xác nhận đặt chỗ' };
      }

      // Lấy danh sách xe của user để map "xe 1", "xe 2" → vehicleId thực
      const userVehicles = userId ? (await this.getUserVehicles(userId)).vehicles || [] : [];

      // Parse "xe 1", "xe 2", "xe 3" → vehicleId
      let vehicleId: string | undefined;
      const xeMatch = msgLower.match(/xe\s*(\d+)/);
      if (xeMatch) {
        const idx = parseInt(xeMatch[1], 10) - 1;
        if (userVehicles[idx]) vehicleId = userVehicles[idx].id.toString();
      }
      // Parse biển số trực tiếp
      if (!vehicleId) {
        const plateMatch = lastUserMessage.match(/\b([0-9]{2}[A-Z]-[0-9]{3,4}\.[0-9]{2}|[0-9]{2}[A-Z][0-9]-[0-9]{5})\b/i);
        if (plateMatch) {
          const found = userVehicles.find((v: any) =>
            v.plate_number?.replace(/\s/g, '').toLowerCase() === plateMatch[1].replace(/\s/g, '').toLowerCase()
          );
          if (found) vehicleId = found.id.toString();
        }
      }

      // Parse tên bãi từ message
      const parkingName = extractParkingName(lastUserMessage);
      let parkingLotId: string | undefined;
      if (parkingName) {
        const lots = await this.getParkingLotsRaw();
        const matched = lots.filter((l) => l.name.toLowerCase().includes(parkingName.toLowerCase()));
        if (matched.length >= 1) parkingLotId = matched[0].id.toString();
      }

      // Gộp với context session nếu có
      const pending = context?.pendingBooking || sessionPendingBooking || {};
      parkingLotId = parkingLotId || pending.parkingLotId;
      vehicleId = vehicleId || pending.vehicleId;
      const startTime = pending.startTime;
      const endTime = pending.endTime;
      const paymentMethod = pending.paymentMethod;

      // Redirect ngay với những gì có, thiếu gì user tự điền trên trang
      const params = new URLSearchParams();
      if (startTime) params.set('start', startTime);
      if (endTime) params.set('end', endTime);
      if (vehicleId) params.set('vehicle', vehicleId);
      if (paymentMethod) params.set('payment', paymentMethod);

      // Tạo message mô tả xe nếu có
      let vehicleDesc = '';
      if (vehicleId) {
        const v = userVehicles.find((x: any) => x.id.toString() === vehicleId);
        if (v) vehicleDesc = ` với xe ${v.plate_number}`;
      }

      // Nếu có lotId → redirect thẳng đến trang đặt bãi đó
      // Nếu không → redirect đến trang tìm kiếm
      const redirectUrl = parkingLotId
        ? `/users/myBooking/${parkingLotId}?${params.toString()}`
        : `/users/parking?${params.toString()}`;

      if (userId) this.stateService.deleteSession(userId);
      return {
        text: parkingLotId
          ? `✅ Đang chuyển đến trang đặt bãi${vehicleDesc}. Bạn có thể điền thêm thông tin còn thiếu trực tiếp trên trang.`
          : `🔍 Bạn muốn đặt bãi nào? Hãy tìm bãi trước hoặc tôi sẽ chuyển bạn đến trang tìm kiếm.`,
        action: 'redirect',
        redirectUrl,
      };
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
      const text = response.choices[0].message.content || 'Xin lỗi, tôi chưa hiểu câu hỏi của bạn.';
      return { text };
    }

    // Mọi intent còn lại → Groq xử lý thay vì fallback cứng
    if (this.groq) {
      const response = await this.groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: this.getSystemPrompt() },
          ...messages.slice(-6),
        ] as any,
        temperature: 0.7,
      });
      return { text: response.choices[0].message.content || 'Xin lỗi, tôi chưa hiểu câu hỏi của bạn.' };
    }
    return {
      text: 'Xin chào! Tôi là trợ lý GoPark. Tôi có thể giúp bạn tìm bãi đỗ, đặt chỗ, xem lịch sử, số dư ví. Bạn cần gì ạ? 😊',
    };
  } catch (error) {
    this.logger.error('processMessage error', error);
    return await this.fallbackProcess(messages, userId);
  }
}

  private getSystemPrompt(): string {
    return `Bạn là trợ lý ảo thông minh của GoPark – ứng dụng đặt chỗ giữ xe. Nhiệm vụ: giúp người dùng tìm bãi đỗ, đặt chỗ, xem lịch sử, số dư ví, hủy đặt, giải đáp thắc mắc.

QUAN TRỌNG:
- Bạn LUÔN gọi tool khi cần dữ liệu thật. KHÔNG tự bịa thông tin.
- Sau khi nhận kết quả từ tool, bạn phân tích và trả lời bằng giọng tự nhiên, thân thiện, không lặp lại nguyên bản.
- Khi người dùng hỏi "bãi phù hợp nhất với tôi" hoặc "gợi ý một bãi" → gọi search_parking với criteria='best_rating', limit=1, và giải thích lý do chọn bãi đó (giá tốt, đánh giá cao, chỗ trống nhiều).
- Khi người dùng hỏi "bãi gần tôi" → gọi search_parking criteria='nearest'.
- Khi hỏi "bãi giá rẻ" → criteria='price_cheapest'.
- Khi hỏi "tìm bãi <tên>" → gọi criteria='by_name', name='<tên>'.
  * Nếu kết quả trả về lots=[], bạn hãy tự động gọi lại search_parking với criteria='area' và lấy tên khu vực từ câu hỏi (ví dụ: "Đà Nẵng") để gợi ý các bãi trong khu vực.
- Khi người dùng muốn đặt bãi, hãy hỏi tuần tự: thời gian (bắt đầu, kết thúc) → xe → phương thức thanh toán.
- Nếu thiếu thông tin, tool book_parking sẽ trả về error missing_fields. Dựa vào đó bạn hỏi bổ sung. KHÔNG tự điền.
- Trả lời ngắn gọn, có dấu câu, dùng icon cảm xúc phù hợp.
- Nếu được hỏi về giờ mở cửa: "GoPark mở cửa 24/7". Liên hệ: hotline 1800-GOPARK.`;
  }

  private getToolsDefinition(): any[] {
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
          message: `❌ Không tìm thấy bãi đỗ nào có tên "${name}". Bạn có muốn tìm bãi ở khu vực ${name} không?`,
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

  private async createBooking(
    args: any,
    userId?: string,
    context?: any,
  ): Promise<any> {
    if (!userId) return { error: 'Cần đăng nhập để đặt bãi' };

    let { parkingLotId, startTime, endTime, vehicleId, paymentMethod } = args;

    // Gộp thông tin từ context đang có (nếu có)
    const pending = context?.pendingBooking || {};
    parkingLotId = parkingLotId || pending.parkingLotId;
    startTime = startTime || pending.startTime;
    endTime = endTime || pending.endTime;
    vehicleId = vehicleId || pending.vehicleId;
    paymentMethod = paymentMethod || pending.paymentMethod;

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
    const { parkingLotId, startTime, endTime, vehicleId, paymentMethod } =
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
      const availableSlots = await manager.query(
        `SELECT * FROM parking_slots WHERE parking_zone_id IN (
     SELECT id FROM parking_zones WHERE parking_floor_id IN (
       SELECT id FROM parking_floors WHERE parking_lot_id = $1
     )
   ) AND status = 'AVAILABLE' LIMIT 1`,
        [parkingLotId],
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
    const lastMsg =
      messages.filter((m) => m.role === 'user').pop()?.content || '';
    if (lastMsg.includes('tìm bãi') || lastMsg.includes('bãi đỗ')) {
      const lots = await this.getParkingLotsRaw();
      const top = lots.slice(0, 3);
      let text = '🔍 Kết quả tìm bãi (chế độ dự phòng):\n';
      top.forEach((l, i) => {
        text += `${i + 1}. ${l.name} - ${l.hourly_rate}đ/h (⭐${l.avgRating.toFixed(1)})\n`;
      });
      return { text, data: { lots: top, action: 'list_parking' } };
    }
    return {
      text: 'Xin chào! Tôi là trợ lý GoPark. Bạn cần tìm bãi đỗ, đặt chỗ hay xem lịch sử?',
    };
  }

  async checkModels(): Promise<any> {
    return { groq: { ok: this.groq !== null } };
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
