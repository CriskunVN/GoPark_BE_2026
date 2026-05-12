import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import Groq from 'groq-sdk';

@Injectable()
export class OwnerChatbotService {
  private readonly logger = new Logger(OwnerChatbotService.name);
  private groq: Groq | null = null;

  constructor(private readonly dataSource: DataSource) {
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
        default:
          return this.fallbackOwnerResponse(messages, userId);
      }
    } catch (error) {
      this.logger.error('processOwnerMessage error', error);
      return { text: '❌ Đã xảy ra lỗi khi xử lý yêu cầu. Vui lòng thử lại.' };
    }
  }

  private classifyOwnerIntent(message: string): string {
    const lower = message.toLowerCase();
    if (lower.includes('tuần') && (lower.includes('doanh thu') || lower.includes('revenue'))) return 'REVENUE_WEEK';
    if (lower.includes('tháng') && (lower.includes('doanh thu') || lower.includes('revenue'))) return 'REVENUE_MONTH';
    if (lower.includes('quý') && (lower.includes('doanh thu') || lower.includes('revenue'))) return 'REVENUE_QUARTER';
    if (lower.includes('so sánh') && lower.includes('tháng')) return 'COMPARE_MONTH';
    if (lower.includes('so sánh') && lower.includes('tuần')) return 'COMPARE_WEEK';
    if (lower.includes('cao nhất') || lower.includes('top') || lower.includes('tốt nhất')) return 'TOP_PARKING';
    if (lower.includes('gợi ý') || lower.includes('tăng doanh thu') || lower.includes('cải thiện')) return 'SUGGEST_IMPROVE';
    if (lower.includes('kém') || lower.includes('thấp') || lower.includes('yếu')) return 'LOW_PERFORMANCE';
    return 'FREE_FORM';
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
      return { text: `📊 Chưa có dữ liệu doanh thu cho ${period === 'week' ? 'tuần' : period === 'month' ? 'tháng' : 'quý'} này.` };
    }

    const total = result.reduce((sum: number, r: any) => sum + parseFloat(r.revenue || 0), 0);
    return {
      text: `📊 ${title}\n💰 Tổng doanh thu: ${total.toLocaleString('vi-VN')}đ`,
      data: {
        action: 'revenue_chart',
        title,
        chartData: {
          headers: ['Bãi đỗ', 'Số booking', 'Doanh thu'],
          rows: result.map((r: any) => [r.name, r.bookings, `${parseFloat(r.revenue).toLocaleString('vi-VN')}đ`]),
        },
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

    return {
      text: `📊 So sánh doanh thu ${periodLabel} này vs kỳ trước:\n\n${periodLabel} này: ${currentRev.toLocaleString('vi-VN')}đ\n${periodLabel} trước: ${previousRev.toLocaleString('vi-VN')}đ\n\n${trend} ${Math.abs(change).toFixed(1)}%`,
      data: {
        action: 'revenue_chart',
        title: `So sánh ${periodLabel}`,
        chartData: {
          headers: ['Kỳ', 'Doanh thu', 'Thay đổi'],
          rows: [
            [`${periodLabel} trước`, `${previousRev.toLocaleString('vi-VN')}đ`, '-'],
            [`${periodLabel} này`, `${currentRev.toLocaleString('vi-VN')}đ`, `${change > 0 ? '+' : ''}${change.toFixed(1)}%`],
          ],
        },
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

    return {
      text: '🏆 Top 5 bãi doanh thu cao nhất (30 ngày qua):',
      data: {
        action: 'revenue_chart',
        title: 'Top 5 bãi doanh thu cao nhất',
        chartData: {
          headers: ['Bãi đỗ', 'Số booking', 'Doanh thu'],
          rows: result.map((r: any) => [r.name, r.bookings, `${parseFloat(r.revenue).toLocaleString('vi-VN')}đ`]),
        },
      },
    };
  }

  private async suggestImprovements(userId: string): Promise<any> {
    return {
      text: `💡 Gợi ý tăng doanh thu:\n\n1. 🎯 Chạy khuyến mãi vào giờ thấp điểm (8h-10h, 14h-16h)\n2. 📱 Tăng cường marketing trên mạng xã hội\n3. ⭐ Cải thiện đánh giá bằng cách nâng cao dịch vụ\n4. 🚗 Mở rộng loại xe phục vụ (xe tải nhỏ, xe máy)\n5. 💳 Thêm phương thức thanh toán linh hoạt\n6. 🔔 Gửi thông báo ưu đãi cho khách hàng cũ`,
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

    return {
      text: '⚠️ Các bãi hoạt động kém (dưới 5 booking/tháng):',
      data: {
        action: 'revenue_chart',
        title: 'Bãi hoạt động kém',
        chartData: {
          headers: ['Bãi đỗ', 'Số booking', 'Doanh thu'],
          rows: result.map((r: any) => [r.name, r.bookings || 0, `${parseFloat(r.revenue || 0).toLocaleString('vi-VN')}đ`]),
        },
        suggestion: 'Hãy xem xét giảm giá, cải thiện vị trí hoặc tăng cường quảng cáo cho các bãi này.',
      },
    };
  }

  private async fallbackOwnerResponse(messages: any[], userId?: string): Promise<any> {
    if (!this.groq) {
      return { text: 'Xin chào! Tôi là trợ lý phân tích GoPark. Bạn có thể hỏi về doanh thu, so sánh, hoặc gợi ý cải thiện.' };
    }

    const systemPrompt = `Bạn là trợ lý phân tích doanh thu cho chủ bãi đỗ xe GoPark. Nhiệm vụ: phân tích doanh thu, so sánh hiệu suất, gợi ý cải thiện. Trả lời ngắn gọn, chuyên nghiệp, có số liệu cụ thể.`;
    const response = await this.groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: systemPrompt }, ...messages.slice(-4)] as any,
      temperature: 0.7,
    });

    return { text: response.choices[0].message.content || 'Xin lỗi, tôi chưa hiểu câu hỏi của bạn.' };
  }
}
