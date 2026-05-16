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

      switch (intent) {
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
          return this.getTopParkingLots(userId);
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
    const lower = message.toLowerCase().normalize('NFC');
    // Có dấu và không dấu
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
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
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
      return { text: `📊 Chưa có dữ liệu doanh thu cho ${period === 'week' ? 'tuần' : period === 'month' ? 'tháng' : 'quý'} này. Hãy đảm bảo bãi đỗ của bạn đã có booking được xác nhận.` };
    }

    const total = result.reduce((sum: number, r: any) => sum + parseFloat(r.revenue || 0), 0);
    const rows = result.map((r: any) => [
      r.name,
      r.bookings,
      `${parseFloat(r.revenue).toLocaleString('vi-VN')}đ`,
    ]);
    return {
      text:
        `## ${title}\n\n` +
        `**Tong doanh thu:** ${total.toLocaleString('vi-VN')}đ\n\n` +
        this.markdownTable(['Bai do', 'So booking', 'Doanh thu'], rows),
      chartData: {
        action: 'revenue_chart',
        title,
        headers: ['Bãi đỗ', 'Số booking', 'Doanh thu'],
        rows,
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
        `## So Sanh Doanh Thu Theo ${periodLabel}\n\n` +
        this.markdownTable(['Ky', 'Doanh thu', 'Thay doi'], rows) +
        `\n\n**Nhan xet:** ${trend} ${Math.abs(change).toFixed(1)}%`,
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

  private async getTopParkingLots(userId: string): Promise<any> {
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
       LIMIT 5`,
      [userId],
    );

    if (!result.length) return { text: '📊 Chưa có dữ liệu bãi đỗ trong 30 ngày qua.' };
    const rows = result.map((r: any) => [
      r.name,
      r.bookings,
      `${parseFloat(r.revenue).toLocaleString('vi-VN')}đ`,
    ]);

    return {
      text:
        `## Top 5 Bai Doanh Thu Cao Nhat\n\n` +
        this.markdownTable(['Bai do', 'So booking', 'Doanh thu'], rows),
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
        this.markdownTable(['Bai do', 'So booking', 'Doanh thu'], rows) +
        `\n\n**Goi y:** Hay xem xet giam gia, cai thien vi tri hoac tang quang cao cho cac bai nay.`,
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
    if (!this.groq) {
      return { text: 'Xin chào! Tôi là trợ lý phân tích GoPark. Bạn có thể hỏi về doanh thu, so sánh, hoặc gợi ý cải thiện.' };
    }

    const systemPrompt = `Bạn là trợ lý phân tích doanh thu cho chủ bãi đỗ xe GoPark.
QUAN TRỌNG: KHÔNG được tự bịa số liệu doanh thu, booking, hay bất kỳ con số cụ thể nào.
Nếu được hỏi về số liệu cụ thể (doanh thu, booking...), hãy trả lời rằng bạn cần truy vấn dữ liệu và hướng dẫn user dùng các câu hỏi như "doanh thu tuần này", "so sánh tháng này".
Chỉ trả lời các câu hỏi chung về chiến lược, gợi ý cải thiện mà không cần số liệu thực.

TÀI LIỆU HƯỚNG DẪN TỪ FILE MARKDOWN:
${this.guideService.getGuide()}`;

    const response = await this.groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: systemPrompt }, ...messages.slice(-4)] as any,
      temperature: 0.5,
    });

    return { text: response.choices[0].message.content || 'Xin lỗi, tôi chưa hiểu câu hỏi của bạn.' };
  }
}
