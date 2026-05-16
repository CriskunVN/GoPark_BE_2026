import { Injectable } from '@nestjs/common';
import { DataSource, Like, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ChatbotSession } from './entities/chatbot-session.entity';

type AdminChatResult = {
  text: string;
  data?: any;
};

@Injectable()
export class AdminChatbotService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ChatbotSession)
    private readonly sessionRepo: Repository<ChatbotSession>,
  ) {}

  async processAdminMessage(
    messages: { role: string; content: string }[],
  ): Promise<AdminChatResult> {
    const message = messages.filter((m) => m.role === 'user').pop()?.content || '';
    const text = this.normalizeText(message);

    if (this.includesAny(text, ['tong quan', 'overview', 'bao cao'])) {
      return this.getOverview();
    }

    if (this.includesAny(text, ['tim user', 'user ', 'email', 'khach hang'])) {
      return this.searchUsers(message);
    }

    if (this.includesAny(text, ['tim bai', 'bai do', 'parking', 'bai xe'])) {
      return this.searchParkingLots(message);
    }

    if (this.includesAny(text, ['doanh thu hom nay', 'revenue today', 'doanh thu today'])) {
      return this.getRevenue('today');
    }

    if (this.includesAny(text, ['doanh thu thang', 'revenue month', 'thang nay'])) {
      return this.getRevenue('month');
    }

    if (this.includesAny(text, ['cho duyet', 'pending', 'yeu cau', 'request'])) {
      return this.getPendingRequests();
    }

    if (this.includesAny(text, ['thanh toan', 'payment', 'invoice', 'hoa don'])) {
      return this.getPaymentIssues();
    }

    return {
      text:
        'Tôi có thể tra nhanh dữ liệu admin. Ví dụ:\n' +
        '- `tổng quan hệ thống`\n' +
        '- `tìm user nguyendung17032005@gmail.com`\n' +
        '- `tìm bãi Mỹ Khê`\n' +
        '- `doanh thu hôm nay`\n' +
        '- `yêu cầu chờ duyệt`\n' +
        '- `hóa đơn chưa thanh toán`',
    };
  }

  private normalizeText(value: string): string {
    return (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9@._\-\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private includesAny(text: string, keywords: string[]): boolean {
    return keywords.some((keyword) => text.includes(this.normalizeText(keyword)));
  }

  private extractQuery(message: string): string {
    return this.normalizeText(message)
      .replace(/\b(tim|kiem|tra|user|khach hang|bai do|bai xe|parking|email|thong tin|cua)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private markdownTable(headers: string[], rows: Array<Array<string | number>>): string {
    if (!rows.length) return '_Không có dữ liệu phù hợp._';
    const header = `| ${headers.join(' | ')} |`;
    const divider = `| ${headers.map(() => '---').join(' | ')} |`;
    const body = rows.map((row) => `| ${row.map((cell) => String(cell)).join(' | ')} |`);
    return [header, divider, ...body].join('\n');
  }

  private money(value: number): string {
    return `${Number(value || 0).toLocaleString('vi-VN')}đ`;
  }

  private async getOverview(): Promise<AdminChatResult> {
    const [users, lots, bookings, revenue] = await Promise.all([
      this.dataSource.query(`SELECT COUNT(*)::int as total FROM users`),
      this.dataSource.query(`SELECT status, COUNT(*)::int as total FROM parking_lots GROUP BY status`),
      this.dataSource.query(
        `SELECT status, COUNT(*)::int as total
         FROM bookings
         WHERE created_at >= CURRENT_DATE
         GROUP BY status`,
      ),
      this.dataSource.query(
        `SELECT COALESCE(SUM(total), 0) as total
         FROM invoices
         WHERE status = 'PAID' AND created_at >= CURRENT_DATE`,
      ),
    ]);

    const lotRows = lots.map((row: any) => [row.status || 'UNKNOWN', row.total]);
    const bookingRows = bookings.map((row: any) => [row.status || 'UNKNOWN', row.total]);
    return {
      text:
        `## Tổng Quan Hệ Thống\n\n` +
        `- Tổng user: **${users[0]?.total || 0}**\n` +
        `- Doanh thu hôm nay: **${this.money(Number(revenue[0]?.total || 0))}**\n\n` +
        `### Bãi đỗ theo trạng thái\n${this.markdownTable(['Trạng thái', 'Số lượng'], lotRows)}\n\n` +
        `### Booking hôm nay\n${this.markdownTable(['Trạng thái', 'Số lượng'], bookingRows)}`,
    };
  }

  private async searchUsers(message: string): Promise<AdminChatResult> {
    const query = this.extractQuery(message);
    if (!query) return { text: 'Bạn muốn tìm user theo email, tên hoặc một phần từ khóa nào?' };

    const rows = await this.dataSource.query(
      `SELECT u.id, u.email, u.status, COALESCE(p.name, '') as name,
              STRING_AGG(r.name, ', ') as roles
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE LOWER(u.email) LIKE $1 OR LOWER(COALESCE(p.name, '')) LIKE $1
       GROUP BY u.id, u.email, u.status, p.name
       ORDER BY u.email ASC
       LIMIT 10`,
      [`%${query}%`],
    );

    return {
      text: `## Kết Quả Tìm User\n\n${this.markdownTable(
        ['Email', 'Tên', 'Role', 'Trạng thái'],
        rows.map((row: any) => [row.email, row.name || '-', row.roles || '-', row.status || '-']),
      )}`,
    };
  }

  private async searchParkingLots(message: string): Promise<AdminChatResult> {
    const query = this.extractQuery(message);
    if (!query) return { text: 'Bạn muốn tìm bãi theo tên hoặc địa chỉ nào?' };

    const rows = await this.dataSource.query(
      `SELECT pl.id, pl.name, pl.address, pl.status, pl.available_slots, pl.total_slots,
              u.email as owner_email
       FROM parking_lots pl
       LEFT JOIN users u ON u.id = pl.user_id
       WHERE LOWER(pl.name) LIKE $1 OR LOWER(pl.address) LIKE $1
       ORDER BY pl.name ASC
       LIMIT 10`,
      [`%${query}%`],
    );

    return {
      text: `## Kết Quả Tìm Bãi Đỗ\n\n${this.markdownTable(
        ['ID', 'Bãi đỗ', 'Chỗ trống', 'Trạng thái', 'Owner'],
        rows.map((row: any) => [
          row.id,
          row.name,
          `${row.available_slots}/${row.total_slots}`,
          row.status || '-',
          row.owner_email || '-',
        ]),
      )}`,
    };
  }

  private async getRevenue(period: 'today' | 'month'): Promise<AdminChatResult> {
    const dateFilter =
      period === 'today'
        ? `i.created_at >= CURRENT_DATE`
        : `i.created_at >= date_trunc('month', CURRENT_DATE)`;
    const rows = await this.dataSource.query(
      `SELECT pl.name,
              COUNT(DISTINCT b.id)::int as bookings,
              COALESCE(SUM(i.total), 0) as revenue
       FROM invoices i
       JOIN bookings b ON b.id = i.booking_id
       JOIN parking_slots ps ON ps.id = b.slot_id
       JOIN parking_zones pz ON pz.id = ps.parking_zone_id
       JOIN parking_floors pf ON pf.id = pz.parking_floor_id
       JOIN parking_lots pl ON pl.id = pf.parking_lot_id
       WHERE i.status = 'PAID' AND ${dateFilter}
       GROUP BY pl.id, pl.name
       ORDER BY revenue DESC
       LIMIT 10`,
    );

    const title = period === 'today' ? 'Doanh Thu Hôm Nay' : 'Doanh Thu Tháng Này';
    const total = rows.reduce((sum: number, row: any) => sum + Number(row.revenue || 0), 0);
    return {
      text:
        `## ${title}\n\n` +
        `Tổng doanh thu: **${this.money(total)}**\n\n` +
        this.markdownTable(
          ['Bãi đỗ', 'Booking', 'Doanh thu'],
          rows.map((row: any) => [row.name, row.bookings, this.money(Number(row.revenue || 0))]),
        ),
    };
  }

  private async getPendingRequests(): Promise<AdminChatResult> {
    const rows = await this.dataSource.query(
      `SELECT r.id, r.type, r.status, u.email, r.created_at
       FROM requests r
       LEFT JOIN users u ON u.id = r.requester_id
       WHERE r.status IN ('PENDING', 'pending')
       ORDER BY r.created_at DESC
       LIMIT 10`,
    );

    return {
      text: `## Yêu Cầu Chờ Duyệt\n\n${this.markdownTable(
        ['ID', 'Loại', 'Email', 'Ngày tạo'],
        rows.map((row: any) => [
          row.id,
          row.type || '-',
          row.email || '-',
          row.created_at ? new Date(row.created_at).toLocaleString('vi-VN') : '-',
        ]),
      )}`,
    };
  }

  private async getPaymentIssues(): Promise<AdminChatResult> {
    const rows = await this.dataSource.query(
      `SELECT i.id, i.status, i.total, b.id as booking_id, u.email
       FROM invoices i
       LEFT JOIN bookings b ON b.id = i.booking_id
       LEFT JOIN users u ON u.id = b.user_id
       WHERE i.status <> 'PAID'
       ORDER BY i.created_at DESC
       LIMIT 10`,
    );

    return {
      text: `## Hóa Đơn Chưa Thanh Toán\n\n${this.markdownTable(
        ['Invoice', 'Booking', 'Email', 'Trạng thái', 'Số tiền'],
        rows.map((row: any) => [
          row.id,
          row.booking_id || '-',
          row.email || '-',
          row.status || '-',
          this.money(Number(row.total || 0)),
        ]),
      )}`,
    };
  }

  async getAdminSessions(userId: string): Promise<any> {
    const sessions = await this.sessionRepo.find({
      where: { userId, title: Like('[ADMIN]%') },
      order: { updatedAt: 'DESC' },
      select: ['id', 'title', 'isActive', 'createdAt', 'updatedAt'],
    });
    return sessions.map((session) => ({
      ...session,
      title: session.title.replace(/^\[ADMIN\]\s*/, ''),
    }));
  }

  async createAdminSession(userId: string, title?: string): Promise<any> {
    const session = this.sessionRepo.create({
      userId,
      title: `[ADMIN] ${title || `Tra cứu ${new Date().toLocaleDateString('vi-VN')}`}`,
      messages: [],
      isActive: true,
    });
    const saved = await this.sessionRepo.save(session);
    return { ...saved, title: saved.title.replace(/^\[ADMIN\]\s*/, '') };
  }

  async getAdminSession(sessionId: string, userId: string): Promise<any> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, userId, title: Like('[ADMIN]%') },
    });
    if (!session) return { messages: [] };
    return { ...session, title: session.title.replace(/^\[ADMIN\]\s*/, '') };
  }

  async deleteAdminSession(sessionId: string, userId: string): Promise<any> {
    await this.sessionRepo.delete({ id: sessionId, userId, title: Like('[ADMIN]%') as any });
    return { success: true };
  }

  async processAdminMessageWithSession(
    messages: { role: string; content: string }[],
    userId: string,
    sessionId: string,
  ): Promise<any> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, userId, title: Like('[ADMIN]%') },
    });
    if (!session) return { text: 'Không tìm thấy session admin.' };

    const fullHistory = [
      ...session.messages.map((m) => ({ role: m.role, content: m.content })),
      ...messages,
    ].slice(-20);
    const result = await this.processAdminMessage(fullHistory);
    const lastUser = messages.filter((m) => m.role === 'user').pop();
    const newMessages = [...session.messages];
    if (lastUser) {
      newMessages.push({ role: 'user', content: lastUser.content, timestamp: Date.now() });
    }
    newMessages.push({
      role: 'assistant',
      content: result.text || '',
      type: 'text',
      data: result.data,
      timestamp: Date.now(),
    });

    let title = session.title;
    if (session.messages.length === 0 && lastUser) {
      title = `[ADMIN] ${lastUser.content.substring(0, 50)}${lastUser.content.length > 50 ? '...' : ''}`;
    }

    await this.sessionRepo.update(
      { id: sessionId, userId },
      { messages: newMessages.slice(-50), title },
    );

    return result;
  }
}
