import { Injectable, Logger } from '@nestjs/common';
import { DataSource, Like, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import Groq from 'groq-sdk';
import { ChatbotSession } from './entities/chatbot-session.entity';
import { ChatbotGuideService } from './chatbot-guide.service';

@Injectable()
export class OwnerChatbotService {
  private readonly logger = new Logger(OwnerChatbotService.name);
  private groq: Groq | null = null;
  private readonly groqModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  private readonly geminiModel = (process.env.GOOGLE_GEMINI_MODEL || 'gemini-2.0-flash').replace(/^models\//, '');
  private readonly maxSessionsPerOwner = 20;
  private readonly pendingParkingConfirm = new Map<string, number>();
  private readonly pendingParkingOptions = new Map<string, number[]>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly guideService: ChatbotGuideService,
    @InjectRepository(ChatbotSession)
    private readonly sessionRepo: Repository<ChatbotSession>,
  ) {
    const apiKey = process.env.GROQ_API_KEY || process.env.GORQ_API_KEY;
    if (!apiKey) {
      this.logger.warn('GROQ_API_KEY missing, owner chatbot chạy chế độ fallback');
    } else {
      this.groq = new Groq({ apiKey });
      this.logger.log('Groq initialized for owner chatbot');
    }
  }

  async processOwnerMessage(messages: { role: string; content: string }[], userId?: string): Promise<any> {
    // Điều phối chính cho OWNER chatbot: phân intent rồi query dữ liệu bãi thuộc owner hiện tại.
    try {
      if (!userId) {
        return { text: '⚠️ Vui lòng đăng nhập để sử dụng tính năng này.' };
      }

      const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || '';
      const selectedOptionId = this.resolvePendingParkingOption(userId, lastUserMessage);
      if (selectedOptionId) {
        this.pendingParkingOptions.delete(userId);
        this.pendingParkingConfirm.delete(userId);
        return this.getParkingLotInfoById(userId, selectedOptionId);
      }

      const pendingLotId = this.pendingParkingConfirm.get(userId);
      if (pendingLotId && this.isPositiveConfirmation(lastUserMessage)) {
        this.pendingParkingConfirm.delete(userId);
        return this.getParkingLotInfoById(userId, pendingLotId);
      }
      if (pendingLotId && this.isNegativeConfirmation(lastUserMessage)) {
        this.pendingParkingConfirm.delete(userId);
        return {
          text: 'Bạn muốn xem bãi nào? Hãy nhập gần đúng tên bãi, ví dụ: "xem thông tin bãi GoPark Quận 1".',
        };
      }

      const intent = this.classifyOwnerIntent(lastUserMessage);
      this.logger.log(`Owner Intent: ${intent} | Message: ${lastUserMessage}`);
      if (this.isClearlyOffTopic(lastUserMessage)) {
        return { text: this.getOffTopicResponse() };
      }

      switch (intent) {
        case 'OWNER_DASHBOARD':
          return this.getOwnerDashboard(userId);
        case 'REVENUE_DETAIL':
          return this.getRevenueDetailAnalysis(userId);
        case 'REVENUE_WEEK':
          return this.getRevenueByPeriod(userId, 'week');
        case 'REVENUE_MONTH':
          return this.getRevenueByPeriod(userId, 'month');
        case 'REVENUE_QUARTER':
          return this.getRevenueByPeriod(userId, 'quarter');
        case 'COMPARE_MONTH':
          return this.compareRevenue(userId, 'month');
        case 'COMPARE_WEEK':
          return this.compareRevenue(userId, 'week');
        case 'TOP_PARKING':
          return this.getTopParkingLots(userId, this.extractLimit(lastUserMessage, 5));
        case 'SUGGEST_IMPROVE':
          return this.suggestImprovements(userId);
        case 'LOW_PERFORMANCE':
          return this.getLowPerformanceLots(userId);
        case 'PARKING_INFO':
          return this.resolveParkingLotInfo(userId, lastUserMessage);
        default:
          return this.fallbackOwnerResponse(messages, userId);
      }
    } catch (error) {
      this.logger.error('processOwnerMessage error', error);
      return { text: '❌ Đã xảy ra lỗi khi xử lý yêu cầu. Vui lòng thử lại.' };
    }
  }

  private classifyOwnerIntent(message: string): string {
    // Phân loại nhanh câu hỏi owner bằng keyword tiếng Việt có dấu/không dấu.
    const lower = message.toLowerCase().normalize('NFC');
    // Có dấu và không dấu
    if (
      (lower.includes('dashboard') || lower.includes('tổng quan') || lower.includes('tong quan') || lower.includes('hôm nay') || lower.includes('hom nay')) &&
      (lower.includes('bãi') || lower.includes('bai') || lower.includes('owner') || lower.includes('vận hành') || lower.includes('van hanh') || lower.includes('booking'))
    ) return 'OWNER_DASHBOARD';
    if (
      (lower.includes('chi tiết') || lower.includes('chi tiet') || lower.includes('phân tích') || lower.includes('phan tich') || lower.includes('vì sao') || lower.includes('vi sao') || lower.includes('tại sao') || lower.includes('tai sao')) &&
      (lower.includes('doanh thu') || lower.includes('doanh') || lower.includes('báo cáo') || lower.includes('bao cao') || lower.includes('thêm') || lower.includes('them'))
    ) return 'REVENUE_DETAIL';
    if (
      (lower.includes('thông tin') || lower.includes('thong tin') || lower.includes('chi tiết') || lower.includes('chi tiet') || lower.includes('xem')) &&
      (lower.includes('bãi') || lower.includes('bai') || lower.includes('parking'))
    ) return 'PARKING_INFO';
    if ((lower.includes('tuần') || lower.includes('tuan')) && (lower.includes('doanh thu') || lower.includes('doanh') || lower.includes('revenue'))) return 'REVENUE_WEEK';
    if ((lower.includes('tháng') || lower.includes('thang')) && (lower.includes('doanh thu') || lower.includes('doanh') || lower.includes('revenue')) && !lower.includes('so sánh') && !lower.includes('so sanh')) return 'REVENUE_MONTH';
    if ((lower.includes('quý') || lower.includes('quy')) && (lower.includes('doanh thu') || lower.includes('doanh'))) return 'REVENUE_QUARTER';
    if ((lower.includes('so sánh') || lower.includes('so sanh')) && (lower.includes('tháng') || lower.includes('thang'))) return 'COMPARE_MONTH';
    if ((lower.includes('so sánh') || lower.includes('so sanh')) && (lower.includes('tuần') || lower.includes('tuan'))) return 'COMPARE_WEEK';
    if (lower.includes('cao nhất') || lower.includes('cao nhat') || lower.includes('top') || lower.includes('tốt nhất') || lower.includes('tot nhat')) return 'TOP_PARKING';
    if (lower.includes('gợi ý') || lower.includes('goi y') || lower.includes('tăng doanh thu') || lower.includes('tang doanh thu') || lower.includes('cải thiện') || lower.includes('cai thien')) return 'SUGGEST_IMPROVE';
    if (lower.includes('kém') || lower.includes('kem') || lower.includes('thấp') || lower.includes('thap') || lower.includes('yếu') || lower.includes('yeu')) return 'LOW_PERFORMANCE';
    if (lower.includes('doanh thu') || lower.includes('doanh') || lower.includes('revenue') || lower.includes('bao cao') || lower.includes('báo cáo')) return 'REVENUE_MONTH';
    return 'FREE_FORM';
  }

  private normalizeText(value: string): string {
    return (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\u0111/g, 'd')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isPositiveConfirmation(message: string): boolean {
    const text = this.normalizeText(message);
    return ['dung', 'co', 'phai', 'ok', 'okay', 'yes', 'chinh xac'].some((keyword) =>
      text === keyword || text.includes(keyword),
    );
  }

  private isNegativeConfirmation(message: string): boolean {
    const text = this.normalizeText(message);
    return ['khong', 'sai', 'khong phai', 'nham'].some((keyword) =>
      text === keyword || text.includes(keyword),
    );
  }

  private isClearlyOffTopic(message: string): boolean {
    const text = this.normalizeText(message);
    if (!text) return false;
    const domainWords = /\b(gopark|bai|parking|do xe|slot|booking|khach|doanh thu|revenue|bao cao|owner|chu bai|gia|vi|thanh toan|yeu cau|van hanh)\b/;
    if (domainWords.test(text)) return false;
    return /\b(code|coding|lap trinh|html|css|javascript|typescript|python|hello world|viet code|source code|script|react|component|nau an|cong thuc|bong da|thoi tiet|xem phim|am nhac|game|giai bai tap|tinh yeu|tu vi|boi bai)\b/.test(text);
  }

  private getOffTopicResponse(): string {
    return [
      'Xin lỗi, tôi chỉ hỗ trợ các câu hỏi liên quan đến vận hành bãi đỗ GoPark.',
      'Tôi không thể viết code/HTML hoặc trả lời các chủ đề ngoài phạm vi bãi đỗ.',
      'Bạn có thể hỏi: `dashboard hôm nay`, `doanh thu tháng này`, `phân tích chi tiết doanh thu`, hoặc `gợi ý tăng doanh thu`.',
    ].join('\n');
  }

  private markdownTable(
    headers: string[],
    rows: Array<Array<string | number>>,
  ): string {
    if (!rows.length) return '_Không có dữ liệu phù hợp._';
    const header = `| ${headers.join(' | ')} |`;
    const divider = `| ${headers.map(() => '---').join(' | ')} |`;
    const body = rows.map((row) => `| ${row.map((cell) => String(cell)).join(' | ')} |`);
    return [header, divider, ...body].join('\n');
  }

  private money(value: number): string {
    return `${Number(value || 0).toLocaleString('vi-VN')}đ`;
  }

  private nextQuestions(items: string[]): string {
    return `\n\n### Bạn có thể hỏi tiếp\n${items.map((item) => `- ${item}`).join('\n')}`;
  }

  private extractLimit(message: string, fallback = 5): number {
    const match = this.normalizeText(message).match(/\btop\s*(\d{1,2})\b|\b(\d{1,2})\s*(bai|ket qua|parking)\b/);
    const value = Number(match?.[1] || match?.[2] || fallback);
    return Math.min(Math.max(value || fallback, 1), 20);
  }

  private extractParkingQuery(message: string): string {
    let text = this.normalizeText(message);
    text = text
      .replace(/\btoi muon\b/g, ' ')
      .replace(/\bcho toi\b/g, ' ')
      .replace(/\bxem\b/g, ' ')
      .replace(/\bthong tin\b/g, ' ')
      .replace(/\bchi tiet\b/g, ' ')
      .replace(/\bcua\b/g, ' ')
      .replace(/\bbai xe\b/g, ' ')
      .replace(/\bbai do\b/g, ' ')
      .replace(/\bbai\b/g, ' ')
      .replace(/\bparking\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text;
  }

  private similarityScore(source: string, target: string): number {
    const a = this.normalizeText(source);
    const b = this.normalizeText(target);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (b.includes(a) || a.includes(b)) return 0.92;

    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j += 1) dp[0][j] = j;
    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      }
    }
    const distance = dp[a.length][b.length];
    return 1 - distance / Math.max(a.length, b.length);
  }

  private async getOwnerParkingLots(userId: string): Promise<any[]> {
    return this.dataSource.query(
      `SELECT id, name, address, status, total_slots, available_slots
       FROM parking_lots
       WHERE user_id = $1
       ORDER BY name ASC`,
      [userId],
    );
  }

  private async getOwnerDashboard(userId: string): Promise<any> {
    // Dashboard vận hành trong ngày: tổng bãi, doanh thu, slot, booking và request của owner.
    const [lots, bookingRows, revenueRows, requestRows] = await Promise.all([
      this.getOwnerParkingLots(userId),
      this.dataSource.query(
        `SELECT b.status, COUNT(*)::int as total
         FROM bookings b
         JOIN parking_slots ps ON ps.id = b.slot_id
         JOIN parking_zones pz ON pz.id = ps.parking_zone_id
         JOIN parking_floors pf ON pf.id = pz.parking_floor_id
         JOIN parking_lots pl ON pl.id = pf.parking_lot_id
         WHERE pl.user_id = $1 AND b.created_at >= CURRENT_DATE
         GROUP BY b.status`,
        [userId],
      ),
      this.dataSource.query(
        `SELECT COALESCE(SUM(i.total), 0) as total
         FROM invoices i
         JOIN bookings b ON b.id = i.booking_id
         JOIN parking_slots ps ON ps.id = b.slot_id
         JOIN parking_zones pz ON pz.id = ps.parking_zone_id
         JOIN parking_floors pf ON pf.id = pz.parking_floor_id
         JOIN parking_lots pl ON pl.id = pf.parking_lot_id
         WHERE pl.user_id = $1 AND i.status = 'PAID' AND i."createdAt" >= CURRENT_DATE`,
        [userId],
      ),
      this.dataSource.query(
        `SELECT status, COUNT(*)::int as total
         FROM system_requests
         WHERE "requesterId" = $1
         GROUP BY status`,
        [userId],
      ),
    ]);
    const totalSlots = lots.reduce((sum, lot) => sum + Number(lot.total_slots || 0), 0);
    const availableSlots = lots.reduce((sum, lot) => sum + Number(lot.available_slots || 0), 0);
    const usedSlots = Math.max(totalSlots - availableSlots, 0);
    const occupancy = totalSlots ? `${((usedSlots / totalSlots) * 100).toFixed(1)}%` : '0%';

    return {
      text:
        `## Dashboard Vận Hành Hôm Nay\n\n` +
        this.markdownTable(['Hạng mục', 'Giá trị'], [
          ['Số bãi đang quản lý', lots.length],
          ['Doanh thu hôm nay', this.money(Number(revenueRows[0]?.total || 0))],
          ['Tổng slot', totalSlots],
          ['Slot đang sử dụng', usedSlots],
          ['Tỷ lệ lấp đầy ước tính', occupancy],
        ]) +
        `\n\n### Booking hôm nay\n${this.markdownTable(['Trạng thái', 'Số lượng'], bookingRows.map((row: any) => [row.status || '-', row.total || 0]))}` +
        `\n\n### Yêu cầu của bạn\n${this.markdownTable(['Trạng thái', 'Số lượng'], requestRows.map((row: any) => [row.status || '-', row.total || 0]))}` +
        this.nextQuestions([
          '`phân tích chi tiết doanh thu`',
          '`bãi hoạt động kém`',
          '`gợi ý tăng doanh thu`',
        ]),
    };
  }

  private async resolveParkingLotInfo(userId: string, message: string): Promise<any> {
    const lots = await this.getOwnerParkingLots(userId);
    if (!lots.length) {
      return { text: 'Bạn chưa có bãi đỗ nào trong hệ thống.' };
    }

    const query = this.extractParkingQuery(message);
    if (!query) {
      const options = lots.slice(0, 5);
      this.pendingParkingOptions.set(userId, options.map((lot) => Number(lot.id)));
      const names = options.map((lot, index) => `Bãi ${index + 1}: ${lot.name}`).join('\n');
      return { text: `Bạn muốn xem thông tin bãi nào?\n${names}\nBạn chỉ cần trả lời "bãi 1" hoặc "bãi 2".` };
    }

    const ranked = lots
      .map((lot) => ({
        lot,
        score: this.similarityScore(query, lot.name),
      }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];

    if (best.score >= 0.88) {
      return this.getParkingLotInfoById(userId, Number(best.lot.id));
    }

    if (best.score >= 0.45) {
      this.pendingParkingConfirm.set(userId, Number(best.lot.id));
      return {
        text: `Tôi không tìm thấy chính xác "${query}". Có phải bạn muốn xem bãi "${best.lot.name}" không? Hãy trả lời "đúng" hoặc "không".`,
      };
    }

    const suggestions = ranked.slice(0, 3).map(({ lot }, index) => `${index + 1}. ${lot.name}`).join('\n');
    return {
      text: `Tôi chưa tìm thấy bãi gần giống "${query}". Một số bãi của bạn:\n${suggestions}\nBạn hãy nhập lại tên bãi rõ hơn.`,
    };
  }

  private resolvePendingParkingOption(userId: string, message: string): number | null {
    const options = this.pendingParkingOptions.get(userId);
    if (!options?.length) return null;

    const text = this.normalizeText(message);
    const match = text.match(/\bbai\s*(\d+)\b/);
    if (!match) return null;

    const selected = options[Number(match[1]) - 1];
    return selected ? Number(selected) : null;
  }

  private async getParkingLotInfoById(userId: string, parkingLotId: number): Promise<any> {
    const lots = await this.dataSource.query(
      `SELECT pl.id,
              pl.name,
              pl.address,
              pl.status,
              pl.total_slots,
              pl.available_slots,
              COUNT(DISTINCT pf.id) as floors,
              COUNT(DISTINCT pz.id) as zones,
              COUNT(DISTINCT ps.id) as slots,
              COUNT(DISTINCT b.id) as bookings_30d,
              COALESCE(SUM(i.total), 0) as revenue_30d
       FROM parking_lots pl
       LEFT JOIN parking_floors pf ON pf.parking_lot_id = pl.id
       LEFT JOIN parking_zones pz ON pz.parking_floor_id = pf.id
       LEFT JOIN parking_slots ps ON ps.parking_zone_id = pz.id
       LEFT JOIN bookings b ON b.slot_id = ps.id
         AND b.created_at >= NOW() - INTERVAL '30 days'
       LEFT JOIN invoices i ON i.booking_id = b.id AND i.status = 'PAID'
       WHERE pl.user_id = $1 AND pl.id = $2
       GROUP BY pl.id, pl.name, pl.address, pl.status, pl.total_slots, pl.available_slots`,
      [userId, parkingLotId],
    );

    const lot = lots[0];
    if (!lot) return { text: 'Không tìm thấy bãi này trong danh sách bãi bạn sở hữu.' };

    const totalSlots = Number(lot.total_slots || lot.slots || 0);
    const availableSlots = Number(lot.available_slots || 0);
    const occupiedSlots = Math.max(totalSlots - availableSlots, 0);
    const occupancyRate = totalSlots > 0 ? (occupiedSlots / totalSlots) * 100 : 0;
    const revenue = Number(lot.revenue_30d || 0);

    return {
      text:
        `📍 Thông tin bãi "${lot.name}"\n` +
        `Địa chỉ: ${lot.address || 'Chưa cập nhật'}\n` +
        `Trạng thái: ${lot.status || 'Không rõ'}\n` +
        `Sức chứa: ${availableSlots}/${totalSlots} chỗ còn trống\n` +
        `Tỷ lệ lấp đầy ước tính: ${occupancyRate.toFixed(1)}%\n` +
        `Cấu trúc: ${lot.floors || 0} tầng, ${lot.zones || 0} khu, ${lot.slots || 0} ô\n` +
        `30 ngày qua: ${lot.bookings_30d || 0} booking, doanh thu ${revenue.toLocaleString('vi-VN')}đ`,
      data: {
        action: 'parking_info',
        lot: {
          id: lot.id,
          name: lot.name,
          address: lot.address,
          status: lot.status,
          totalSlots,
          availableSlots,
          occupiedSlots,
          occupancyRate,
          floors: Number(lot.floors || 0),
          zones: Number(lot.zones || 0),
          slots: Number(lot.slots || 0),
          bookings30d: Number(lot.bookings_30d || 0),
          revenue30d: revenue,
        },
      },
    };
  }

  private async getRevenueByPeriod(userId: string, period: 'week' | 'month' | 'quarter'): Promise<any> {
    let dateFilter = '';
    let title = '';
    if (period === 'week') {
      dateFilter = "b.created_at >= NOW() - INTERVAL '7 days'";
      title = 'Doanh thu 7 ngày qua';
    } else if (period === 'month') {
      dateFilter = "b.created_at >= NOW() - INTERVAL '30 days'";
      title = 'Doanh thu 30 ngày qua';
    } else {
      dateFilter = "b.created_at >= NOW() - INTERVAL '90 days'";
      title = 'Doanh thu quý này (90 ngày)';
    }

    // bookings -> invoices để lấy total, join parking_lots qua parking_slots -> parking_zones -> parking_floors
    const result = await this.dataSource.query(
      `SELECT pl.name,
              COUNT(DISTINCT b.id) as bookings,
              COALESCE(SUM(i.total), 0) as revenue
       FROM parking_lots pl
       JOIN parking_floors pf ON pf.parking_lot_id = pl.id
       JOIN parking_zones pz ON pz.parking_floor_id = pf.id
       JOIN parking_slots ps ON ps.parking_zone_id = pz.id
       JOIN bookings b ON b.slot_id = ps.id
       LEFT JOIN invoices i ON i.booking_id = b.id AND i.status = 'PAID'
       WHERE pl.user_id = $1
         AND ${dateFilter}
         AND b.status IN ('CONFIRMED', 'COMPLETED', 'ONGOING')
       GROUP BY pl.id, pl.name
       ORDER BY revenue DESC`,
      [userId],
    );

    if (!result.length) {
      return {
        text:
          `📊 Chưa có dữ liệu doanh thu cho ${period === 'week' ? 'tuần' : period === 'month' ? 'tháng' : 'quý'} này. Hãy đảm bảo bãi đỗ của bạn đã có booking được xác nhận.` +
          this.nextQuestions([
            '`xem thông tin bãi` để kiểm tra sức chứa và trạng thái',
            '`gợi ý tăng doanh thu` để nhận checklist cải thiện',
            '`bãi hoạt động kém` để tìm bãi cần ưu tiên',
          ]),
      };
    }

    const total = result.reduce((sum: number, r: any) => sum + parseFloat(r.revenue || 0), 0);
    const totalBookings = result.reduce((sum: number, r: any) => sum + Number(r.bookings || 0), 0);
    const top = result[0];
    const weak = [...result].sort((a: any, b: any) => Number(a.revenue || 0) - Number(b.revenue || 0))[0];
    const topRevenue = Number(top?.revenue || 0);
    const topShare = total > 0 ? (topRevenue / total) * 100 : 0;
    const avgTicket = totalBookings > 0 ? total / totalBookings : 0;
    const rows = result.map((r: any) => [
      r.name,
      r.bookings,
      this.money(parseFloat(r.revenue)),
    ]);
    return {
      text:
        `## ${title}\n\n` +
        `**Tổng doanh thu:** ${this.money(total)} từ **${totalBookings}** booking.\n\n` +
        this.markdownTable(['Bãi đỗ', 'Số booking', 'Doanh thu'], rows) +
        `\n\n### Nhận xét nhanh\n` +
        `- Bãi đóng góp cao nhất: **${top?.name || '-'}** (${this.money(topRevenue)}, ${topShare.toFixed(1)}% tổng doanh thu).\n` +
        `- Doanh thu trung bình mỗi booking: **${this.money(avgTicket)}**.\n` +
        `- Bãi cần xem thêm: **${weak?.name || '-'}** vì doanh thu đang thấp nhất trong nhóm.\n` +
        `- Kết luận: ${topShare >= 60 ? 'doanh thu đang phụ thuộc khá nhiều vào một bãi, nên kiểm tra các bãi còn lại để giảm rủi ro.' : 'doanh thu phân bổ tương đối đều, có thể tập trung tối ưu bãi có tiềm năng tăng trưởng.'}` +
        this.nextQuestions([
          '`phân tích chi tiết doanh thu` để xem tỷ trọng và doanh thu/booking',
          '`so sánh tháng này với tháng trước` để biết xu hướng tăng giảm',
          '`gợi ý tăng doanh thu` để có checklist hành động',
        ]),
      chartData: {
        action: 'revenue_chart',
        title,
        headers: ['Bãi đỗ', 'Số booking', 'Doanh thu'],
        rows,
        suggestion: `Hỏi tiếp "phân tích chi tiết doanh thu" nếu bạn muốn biết bãi nào đang kéo kết quả lên hoặc xuống.`,
      },
    };
  }

  private async getRevenueDetailAnalysis(userId: string): Promise<any> {
    const rows = await this.dataSource.query(
      `SELECT pl.name,
              pl.available_slots,
              pl.total_slots,
              COUNT(DISTINCT b.id)::int as bookings,
              COALESCE(SUM(i.total), 0) as revenue
       FROM parking_lots pl
       LEFT JOIN parking_floors pf ON pf.parking_lot_id = pl.id
       LEFT JOIN parking_zones pz ON pz.parking_floor_id = pf.id
       LEFT JOIN parking_slots ps ON ps.parking_zone_id = pz.id
       LEFT JOIN bookings b ON b.slot_id = ps.id
         AND b.created_at >= NOW() - INTERVAL '30 days'
         AND b.status IN ('CONFIRMED', 'COMPLETED', 'ONGOING')
       LEFT JOIN invoices i ON i.booking_id = b.id AND i.status = 'PAID'
       WHERE pl.user_id = $1
       GROUP BY pl.id, pl.name, pl.available_slots, pl.total_slots
       ORDER BY revenue DESC`,
      [userId],
    );

    if (!rows.length) {
      return {
        text:
          'Chưa có đủ dữ liệu 30 ngày gần nhất để phân tích chi tiết doanh thu.' +
          this.nextQuestions([
            '`xem thông tin bãi` để kiểm tra dữ liệu bãi',
            '`bãi hoạt động kém` để xem bãi ít booking',
          ]),
      };
    }

    const totalRevenue = rows.reduce((sum: number, row: any) => sum + Number(row.revenue || 0), 0);
    const totalBookings = rows.reduce((sum: number, row: any) => sum + Number(row.bookings || 0), 0);
    const enriched = rows.map((row: any) => {
      const revenue = Number(row.revenue || 0);
      const bookings = Number(row.bookings || 0);
      const totalSlots = Number(row.total_slots || 0);
      const availableSlots = Number(row.available_slots || 0);
      const occupiedRate = totalSlots > 0 ? ((totalSlots - availableSlots) / totalSlots) * 100 : 0;
      return {
        name: row.name,
        bookings,
        revenue,
        share: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
        avgTicket: bookings > 0 ? revenue / bookings : 0,
        occupiedRate,
      };
    });
    const top = enriched[0];
    const weak = [...enriched].sort((a, b) => a.revenue - b.revenue || a.bookings - b.bookings)[0];
    const bestTicket = [...enriched].sort((a, b) => b.avgTicket - a.avgTicket)[0];
    const tableRows = enriched.slice(0, 8).map((row) => [
      row.name,
      row.bookings,
      this.money(row.revenue),
      `${row.share.toFixed(1)}%`,
      this.money(row.avgTicket),
    ]);

    return {
      text:
        `## Phân Tích Chi Tiết Doanh Thu 30 Ngày\n\n` +
        `Tổng doanh thu: **${this.money(totalRevenue)}**, tổng booking: **${totalBookings}**.\n\n` +
        this.markdownTable(['Bãi đỗ', 'Booking', 'Doanh thu', 'Tỷ trọng', 'TB/booking'], tableRows) +
        `\n\n### Đọc kết quả\n` +
        `- **${top.name}** đang dẫn đầu, chiếm ${top.share.toFixed(1)}% doanh thu. ${top.share >= 60 ? 'Tỷ trọng này cao, cần tránh phụ thuộc một bãi.' : 'Tỷ trọng này chưa quá lệch, có thể tiếp tục tối ưu.'}\n` +
        `- **${bestTicket.name}** có doanh thu trung bình/booking tốt nhất (${this.money(bestTicket.avgTicket)}), đáng xem lại cách định giá hoặc nhóm khách.\n` +
        `- **${weak.name}** đang yếu nhất (${weak.bookings} booking, ${this.money(weak.revenue)}). Nên kiểm tra giá, vị trí hiển thị, ảnh bãi và đánh giá.\n\n` +
        `### Gợi ý hành động\n` +
        `1. Nếu bãi yếu còn nhiều chỗ trống, thử ưu đãi giờ thấp điểm trong 7 ngày.\n` +
        `2. Nếu bãi mạnh gần đầy, cân nhắc tăng nhẹ giá giờ cao điểm hoặc ưu tiên khách đặt trước.\n` +
        `3. Hỏi lại "so sánh tuần này" sau khi thay đổi để kiểm chứng tác động.` +
        this.nextQuestions([
          '`bãi hoạt động kém` để khoanh vùng bãi cần xử lý',
          '`top 5 bãi tốt nhất` để xem nhóm đang kéo doanh thu',
          '`xem thông tin bãi <tên bãi>` để kiểm tra riêng một bãi',
        ]),
      chartData: {
        action: 'revenue_chart',
        title: 'Phân tích chi tiết doanh thu',
        headers: ['Bãi đỗ', 'Booking', 'Doanh thu', 'Tỷ trọng', 'TB/booking'],
        rows: tableRows,
        suggestion: `Ưu tiên xem "${weak.name}" trước vì đây là bãi đang kéo hiệu suất xuống.`,
      },
    };
  }

  private async compareRevenue(userId: string, period: 'week' | 'month'): Promise<any> {
    const days = period === 'week' ? 7 : 30;
    const baseQuery = `
      SELECT COALESCE(SUM(i.total), 0) as revenue
      FROM parking_lots pl
      JOIN parking_floors pf ON pf.parking_lot_id = pl.id
      JOIN parking_zones pz ON pz.parking_floor_id = pf.id
      JOIN parking_slots ps ON ps.parking_zone_id = pz.id
      JOIN bookings b ON b.slot_id = ps.id
      LEFT JOIN invoices i ON i.booking_id = b.id AND i.status = 'PAID'
      WHERE pl.user_id = $1
        AND b.status IN ('CONFIRMED', 'COMPLETED', 'ONGOING')`;

    const current = await this.dataSource.query(
      `${baseQuery} AND b.created_at >= NOW() - INTERVAL '${days} days'`,
      [userId],
    );
    const previous = await this.dataSource.query(
      `${baseQuery} AND b.created_at >= NOW() - INTERVAL '${days * 2} days'
                    AND b.created_at < NOW() - INTERVAL '${days} days'`,
      [userId],
    );

    const currentRev = parseFloat(current[0]?.revenue || 0);
    const previousRev = parseFloat(previous[0]?.revenue || 0);
    const change = previousRev > 0 ? ((currentRev - previousRev) / previousRev) * 100 : 0;
    const trend = change > 0 ? '📈 Tăng' : change < 0 ? '📉 Giảm' : '➡️ Không đổi';
    const periodLabel = period === 'week' ? 'tuần' : 'tháng';
    const rows = [
      [`${periodLabel} trước`, `${previousRev.toLocaleString('vi-VN')}đ`, '-'],
      [`${periodLabel} này`, `${currentRev.toLocaleString('vi-VN')}đ`, `${change > 0 ? '+' : ''}${change.toFixed(1)}%`],
    ];

    return {
      text:
        `## So Sánh Doanh Thu Theo ${periodLabel}\n\n` +
        this.markdownTable(['Kỳ', 'Doanh thu', 'Thay đổi'], rows) +
        `\n\n### Nhận xét\n` +
        `- Xu hướng: **${trend} ${Math.abs(change).toFixed(1)}%**.\n` +
        `- Chênh lệch tuyệt đối: **${this.money(currentRev - previousRev)}**.\n` +
        `- ${change < 0 ? 'Cần xem bãi nào giảm booking hoặc giảm doanh thu/booking.' : change > 0 ? 'Kết quả đang tốt, nên tìm bãi đóng góp chính để nhân rộng.' : 'Doanh thu ổn định, nên kiểm tra liệu số booking có đang tăng hay chỉ giữ nguyên.'}` +
        this.nextQuestions([
          '`phân tích chi tiết doanh thu` để xem bãi nào kéo tăng/giảm',
          '`gợi ý tăng doanh thu` để có hành động tiếp theo',
          '`bãi hoạt động kém` để tìm điểm nghẽn',
        ]),
      chartData: {
        action: 'revenue_chart',
        title: `So sánh ${periodLabel}`,
        headers: ['Kỳ', 'Doanh thu', 'Thay đổi'],
        rows,
        suggestion: change < 0
          ? 'Doanh thu giảm. Hãy xem xét chạy khuyến mãi hoặc cải thiện dịch vụ.'
          : 'Doanh thu tăng tốt! Tiếp tục duy trì chất lượng.',
      },
    };
  }

  private async getTopParkingLots(userId: string, limit = 5): Promise<any> {
    const result = await this.dataSource.query(
      `SELECT pl.name,
              COUNT(DISTINCT b.id) as bookings,
              COALESCE(SUM(i.total), 0) as revenue
       FROM parking_lots pl
       JOIN parking_floors pf ON pf.parking_lot_id = pl.id
       JOIN parking_zones pz ON pz.parking_floor_id = pf.id
       JOIN parking_slots ps ON ps.parking_zone_id = pz.id
       JOIN bookings b ON b.slot_id = ps.id
       LEFT JOIN invoices i ON i.booking_id = b.id AND i.status = 'PAID'
       WHERE pl.user_id = $1
         AND b.created_at >= NOW() - INTERVAL '30 days'
         AND b.status IN ('CONFIRMED', 'COMPLETED', 'ONGOING')
       GROUP BY pl.id, pl.name
       ORDER BY revenue DESC
       LIMIT $2`,
      [userId, limit],
    );

    if (!result.length) return { text: '📊 Chưa có dữ liệu bãi đỗ trong 30 ngày qua.' };
    const rows = result.map((r: any) => [
      r.name,
      r.bookings,
      `${parseFloat(r.revenue).toLocaleString('vi-VN')}đ`,
    ]);

    return {
      text:
        `## Top ${limit} Bãi Doanh Thu Cao Nhất\n\n` +
        this.markdownTable(['Bãi đỗ', 'Số booking', 'Doanh thu'], rows) +
        `\n\n### Nhận xét nhanh\n` +
        `- Bãi đứng đầu là **${result[0]?.name || '-'}**, có thể là mẫu tốt để so sánh giá, ảnh, vị trí và vận hành.\n` +
        `- Nếu một bãi có booking cao nhưng doanh thu thấp, hãy kiểm tra lại giá trung bình/booking.\n` +
        `- Nếu một bãi doanh thu cao nhưng booking thấp, có thể bãi đó đang có giá tốt hoặc khách lưu trú lâu hơn.` +
        this.nextQuestions([
          '`phân tích chi tiết doanh thu` để xem tỷ trọng từng bãi',
          '`xem thông tin bãi <tên bãi>` để kiểm tra riêng bãi top',
          '`bãi hoạt động kém` để so sánh với nhóm yếu',
        ]),
      chartData: {
        action: 'revenue_chart',
        title: 'Top 5 bãi doanh thu cao nhất',
        headers: ['Bãi đỗ', 'Số booking', 'Doanh thu'],
        rows,
      },
    };
  }

  private async suggestImprovements(userId: string): Promise<any> {
    const stats = await this.dataSource.query(
      `SELECT pl.name,
              pl.available_slots,
              pl.total_slots,
              COUNT(DISTINCT b.id) as bookings,
              COALESCE(SUM(i.total), 0) as revenue
       FROM parking_lots pl
       LEFT JOIN parking_floors pf ON pf.parking_lot_id = pl.id
       LEFT JOIN parking_zones pz ON pz.parking_floor_id = pf.id
       LEFT JOIN parking_slots ps ON ps.parking_zone_id = pz.id
       LEFT JOIN bookings b ON b.slot_id = ps.id
         AND b.created_at >= NOW() - INTERVAL '30 days'
         AND b.status IN ('CONFIRMED', 'COMPLETED', 'ONGOING')
       LEFT JOIN invoices i ON i.booking_id = b.id AND i.status = 'PAID'
       WHERE pl.user_id = $1
       GROUP BY pl.id, pl.name, pl.available_slots, pl.total_slots
       ORDER BY revenue DESC`,
      [userId],
    );

    if (!stats.length) {
      return {
        text: 'Bạn chưa có dữ liệu bãi đỗ để phân tích. Khi có booking, tôi sẽ gợi ý theo doanh thu, số lượt đặt và tỷ lệ chỗ trống.',
      };
    }

    const normalized = stats.map((row: any) => ({
      name: row.name,
      bookings: Number(row.bookings || 0),
      revenue: Number(row.revenue || 0),
      availableSlots: Number(row.available_slots || 0),
      totalSlots: Number(row.total_slots || 0),
    }));
    const top = normalized[0];
    const weak = [...normalized].sort(
      (a, b) => a.bookings - b.bookings || a.revenue - b.revenue,
    )[0];
    const totalRevenue = normalized.reduce((sum, row) => sum + row.revenue, 0);
    const totalBookings = normalized.reduce((sum, row) => sum + row.bookings, 0);
    const rows = normalized
      .slice(0, 5)
      .map((row) => [
        row.name,
        row.bookings,
        `${row.revenue.toLocaleString('vi-VN')}đ`,
      ]);

    return {
      text:
        `## Goi Y Tang Doanh Thu\n\n` +
        `**Tong quan 30 ngay:** ${totalBookings} booking, ${totalRevenue.toLocaleString('vi-VN')}đ.\n\n` +
        this.markdownTable(['Bai do', 'Booking 30 ngay', 'Doanh thu'], rows) +
        `\n\n**Diem manh:** "${top.name}" dang keo doanh thu tot nhat.\n` +
        `**Can uu tien:** "${weak.name}" vi chi co ${weak.bookings} booking, ${weak.revenue.toLocaleString('vi-VN')}đ.\n\n` +
        `### Hanh dong nen lam\n` +
        `1. Chạy ưu đãi giờ thấp điểm cho "${weak.name}" trong 7 ngày.\n` +
        `2. Đẩy bãi "${top.name}" làm mẫu vận hành: giữ giá ổn định, tăng hiển thị nếu còn nhiều chỗ trống.\n` +
        `3. Kiểm tra ảnh, mô tả, vị trí bản đồ và giá của các bãi ít booking trước khi giảm giá sâu.\n` +
        `4. Sau 7 ngày, hỏi tôi "so sánh tuần này" để kiểm tra tác động.`,
      chartData: {
        action: 'revenue_chart',
        title: 'Gợi ý cải thiện theo dữ liệu',
        headers: ['Bãi đỗ', 'Booking 30 ngày', 'Doanh thu'],
        rows,
        suggestion: `Ưu tiên xử lý "${weak.name}" trước, vì đây là bãi có hiệu suất thấp nhất trong dữ liệu hiện tại.`,
      },
    };
  }

  private async getLowPerformanceLots(userId: string): Promise<any> {
    const result = await this.dataSource.query(
      `SELECT pl.name,
              COUNT(DISTINCT b.id) as bookings,
              COALESCE(SUM(i.total), 0) as revenue
       FROM parking_lots pl
       LEFT JOIN parking_floors pf ON pf.parking_lot_id = pl.id
       LEFT JOIN parking_zones pz ON pz.parking_floor_id = pf.id
       LEFT JOIN parking_slots ps ON ps.parking_zone_id = pz.id
       LEFT JOIN bookings b ON b.slot_id = ps.id
         AND b.created_at >= NOW() - INTERVAL '30 days'
         AND b.status IN ('CONFIRMED', 'COMPLETED', 'ONGOING')
       LEFT JOIN invoices i ON i.booking_id = b.id AND i.status = 'PAID'
       WHERE pl.user_id = $1
       GROUP BY pl.id, pl.name
       HAVING COUNT(DISTINCT b.id) < 5
       ORDER BY bookings ASC
       LIMIT 3`,
      [userId],
    );

    if (!result.length) return { text: '✅ Tất cả bãi đỗ của bạn đang hoạt động tốt!' };
    const rows = result.map((r: any) => [
      r.name,
      r.bookings || 0,
      `${parseFloat(r.revenue || 0).toLocaleString('vi-VN')}đ`,
    ]);

    return {
      text:
        `## Bai Hoat Dong Kem\n\n` +
        this.markdownTable(['Bãi đỗ', 'Số booking', 'Doanh thu'], rows) +
        `\n\n### Nên kiểm tra\n` +
        `- Giá theo giờ/ngày có đang cao hơn nhóm bãi tương tự không.\n` +
        `- Ảnh, địa chỉ, vị trí bản đồ và mô tả có đủ rõ để khách tin tưởng không.\n` +
        `- Bãi có còn nhiều chỗ trống vào giờ cao điểm nhưng ít booking không.\n\n` +
        `**Gợi ý:** ưu tiên chỉnh từng bãi một, theo dõi lại sau 7 ngày để biết thay đổi có hiệu quả không.` +
        this.nextQuestions([
          '`xem thông tin bãi <tên bãi>` để kiểm tra chi tiết',
          '`gợi ý tăng doanh thu` để nhận checklist cải thiện',
          '`so sánh tuần này` để đo tác động sau khi chỉnh',
        ]),
      chartData: {
        action: 'revenue_chart',
        title: 'Bãi hoạt động kém',
        headers: ['Bãi đỗ', 'Số booking', 'Doanh thu'],
        rows,
        suggestion: 'Hãy xem xét giảm giá, cải thiện vị trí hoặc tăng cường quảng cáo cho các bãi này.',
      },
    };
  }

  async getOwnerSessions(userId: string): Promise<any> {
    const sessions = await this.sessionRepo.find({
      where: { userId, title: Like('[OWNER]%') },
      order: { updatedAt: 'DESC' },
      select: ['id', 'title', 'isActive', 'createdAt', 'updatedAt'],
    });
    return sessions.map((session) => ({
      ...session,
      title: session.title.replace(/^\[OWNER\]\s*/, ''),
    }));
  }

  async createOwnerSession(userId: string, title?: string): Promise<any> {
    const session = this.sessionRepo.create({
      userId,
      title: `[OWNER] ${title || `Phân tích ${new Date().toLocaleDateString('vi-VN')}`}`,
      messages: [],
      isActive: true,
    });
    const saved = await this.sessionRepo.save(session);
    await this.pruneOwnerSessions(userId);
    return { ...saved, title: saved.title.replace(/^\[OWNER\]\s*/, '') };
  }

  async getOwnerSession(sessionId: string, userId: string): Promise<any> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, userId, title: Like('[OWNER]%') },
    });
    if (!session) return { messages: [] };
    return { ...session, title: session.title.replace(/^\[OWNER\]\s*/, '') };
  }

  async deleteOwnerSession(sessionId: string, userId: string): Promise<any> {
    await this.sessionRepo.delete({ id: sessionId, userId, title: Like('[OWNER]%') as any });
    return { success: true };
  }

  private async pruneOwnerSessions(userId: string): Promise<void> {
    const sessions = await this.sessionRepo.find({
      where: { userId, title: Like('[OWNER]%') },
      order: { updatedAt: 'DESC' },
      select: ['id', 'updatedAt'],
    });
    const oldSessions = sessions.slice(this.maxSessionsPerOwner);
    if (!oldSessions.length) return;
    await Promise.all(oldSessions.map((session) => this.sessionRepo.delete({ id: session.id, userId })));
  }

  async processOwnerMessageWithSession(
    messages: { role: string; content: string }[],
    userId: string,
    sessionId: string,
  ): Promise<any> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, userId, title: Like('[OWNER]%') },
    });
    if (!session) return { text: '❌ Không tìm thấy session.' };

    const fullHistory = [
      ...session.messages.map((m) => ({ role: m.role, content: m.content })),
      ...messages,
    ].slice(-20);

    const result = await this.processOwnerMessage(fullHistory, userId);
    const lastUser = messages.filter((m) => m.role === 'user').pop();
    const newMessages = [...session.messages];
    if (lastUser) {
      newMessages.push({ role: 'user', content: lastUser.content, timestamp: Date.now() });
    }
    newMessages.push({
      role: 'assistant',
      content: result.text || '',
      type: result.chartData?.action === 'revenue_chart' ? 'revenue-chart' : 'text',
      data: result.chartData,
      timestamp: Date.now(),
    });

    let title = session.title;
    if (session.messages.length === 0 && lastUser) {
      title = `[OWNER] ${lastUser.content.substring(0, 50)}${lastUser.content.length > 50 ? '...' : ''}`;
    }

    await this.sessionRepo.update(
      { id: sessionId, userId },
      { messages: newMessages.slice(-50), title },
    );

    return result;
  }

  private async fallbackOwnerResponse(messages: any[], userId?: string): Promise<any> {
    const systemPrompt = `Bạn là trợ lý phân tích doanh thu cho chủ bãi đỗ xe GoPark.
PHAM VI BAT BUOC: chi tra loi cau hoi lien quan den GoPark, bai do, booking, doanh thu, thanh toan va van hanh owner. Neu user yeu cau viet code/HTML hoac hoi chu de ngoai bai do, hay xin loi va tu choi ngan gon.
QUAN TRỌNG: KHÔNG được tự bịa số liệu doanh thu, booking, hay bất kỳ con số cụ thể nào.
Nếu được hỏi về số liệu cụ thể (doanh thu, booking...), hãy trả lời rằng bạn cần truy vấn dữ liệu và hướng dẫn user dùng các câu hỏi như "doanh thu tuần này", "so sánh tháng này".
Chỉ trả lời các câu hỏi chung về chiến lược, gợi ý cải thiện mà không cần số liệu thực.

TÀI LIỆU HƯỚNG DẪN TỪ FILE MARKDOWN:
${this.guideService.getGuide()}`;

    const text = await this.completeTextWithGroqThenGemini(
      [{ role: 'system', content: systemPrompt }, ...messages.slice(-4)],
      0.5,
    );

    return { text: text || 'Xin chào! Tôi là trợ lý phân tích GoPark. Bạn có thể hỏi về doanh thu, so sánh, hoặc gợi ý cải thiện.' };
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
        this.logger.warn('Groq rate limit reached, falling back to Gemini for owner chatbot');
      }
    }

    return this.completeWithGemini(messages, temperature);
  }

  private async completeWithGemini(
    messages: Array<{ role: string; content?: string }>,
    temperature = 0.5,
  ): Promise<string | null> {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    const systemParts: string[] = [];
    const contents = messages
      .map((message) => {
        const content = message.content || '';
        if (!content.trim()) return null;
        if (message.role === 'system') {
          systemParts.push(content);
          return null;
        }
        return {
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: content }],
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
          generationConfig: { temperature, maxOutputTokens: 700 },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.warn(`Gemini owner fallback failed: ${response.status} ${errorText.slice(0, 180)}`);
      return null;
    }

    const data = await response.json();
    return data?.candidates?.[0]?.content?.parts
      ?.map((part: any) => part.text || '')
      .join('')
      .trim() || null;
  }
}

