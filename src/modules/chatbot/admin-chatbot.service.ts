import { Injectable } from '@nestjs/common';
import { DataSource, Like, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ChatbotSession } from './entities/chatbot-session.entity';
import { RequestStatus } from '../../common/enums/status.enum';

type AdminChatResult = {
  text: string;
  data?: any;
};

@Injectable()
export class AdminChatbotService {
  private readonly maxSessionsPerAdmin = 20;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ChatbotSession)
    private readonly sessionRepo: Repository<ChatbotSession>,
  ) {}

  async processAdminMessage(
    messages: { role: string; content: string }[],
  ): Promise<AdminChatResult> {
    // Điều phối chính cho ADMIN chatbot: route câu hỏi sang các hàm query dữ liệu quản trị.
    const message =
      messages.filter((m) => m.role === 'user').pop()?.content || '';
    const text = this.normalizeText(message);
    if (this.isClearlyOffTopic(message)) {
      return { text: this.getOffTopicResponse() };
    }

    if (this.includesAny(text, ['canh bao', 'bat thuong', 'risk', 'rui ro', 'alert'])) {
      return this.getSystemAlerts();
    }

    if (this.includesAny(text, ['tong quan', 'overview', 'bao cao'])) {
      return this.getOverview();
    }

    if (this.includesAny(text, ['tim user', 'user ', 'email', 'khach hang'])) {
      return this.searchUsers(message);
    }

    if (this.isParkingRankingRequest(text)) {
      return this.getParkingRanking(message);
    }

    if (this.includesAny(text, ['tim bai', 'bai do', 'parking', 'bai xe'])) {
      return this.searchParkingLots(message);
    }

    if (
      this.includesAny(text, [
        'doanh thu hom nay',
        'revenue today',
        'doanh thu today',
      ])
    ) {
      return this.getRevenue('today');
    }

    if (
      this.includesAny(text, ['doanh thu thang', 'revenue month', 'thang nay'])
    ) {
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
        'T\u00f4i c\u00f3 th\u1ec3 tra nhanh d\u1eef li\u1ec7u admin. V\u00ed d\u1ee5:\n' +
        '- `t\u1ed5ng quan h\u1ec7 th\u1ed1ng`\n' +
        '- `t\u00ecm user nguyendung17032005@gmail.com`\n' +
        '- `t\u00ecm b\u00e3i M\u1ef9 Kh\u00ea`\n' +
        '- `top 5 b\u00e3i nhi\u1ec1u ch\u1ed7 tr\u1ed1ng`\n' +
        '- `doanh thu h\u00f4m nay`\n' +
        '- `y\u00eau c\u1ea7u ch\u1edd duy\u1ec7t`\n' +
        '- `h\u00f3a \u0111\u01a1n ch\u01b0a thanh to\u00e1n`',
    };
  }

  private normalizeText(value: string): string {
    return (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\u0111/g, 'd')
      .replace(/[^a-z0-9@._\-\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private includesAny(text: string, keywords: string[]): boolean {
    return keywords.some((keyword) =>
      text.includes(this.normalizeText(keyword)),
    );
  }

  private isParkingRankingRequest(text: string): boolean {
    return (
      this.includesAny(text, [
        'top',
        'cao nhat',
        'mac nhat',
        'dat nhat',
        're nhat',
        'danh gia',
        'nhieu cho',
        'cho trong',
      ]) && this.includesAny(text, ['bai', 'parking', 'cho trong'])
    );
  }

  private isClearlyOffTopic(message: string): boolean {
    const text = this.normalizeText(message);
    if (!text) return false;
    const domainWords = /\b(gopark|admin|user|khach hang|owner|chu bai|bai|parking|booking|doanh thu|revenue|hoa don|invoice|thanh toan|payment|request|yeu cau|duyet|he thong|bao cao)\b/;
    if (domainWords.test(text)) return false;
    return /\b(nau an|cong thuc|bong da|thoi tiet|xem phim|am nhac|game|giai bai tap|lap trinh|tinh yeu|tu vi|boi bai)\b/.test(text);
  }

  private getOffTopicResponse(): string {
    return [
      'Xin lỗi, câu hỏi này nằm ngoài phạm vi quản trị GoPark nên tôi không trả lời lan man.',
      'Tôi có thể hỗ trợ admin tra cứu dữ liệu hệ thống, user, bãi đỗ, doanh thu, thanh toán và yêu cầu chờ duyệt.',
      'Bạn có thể hỏi: `tổng quan hệ thống`, `cảnh báo hệ thống`, `yêu cầu chờ duyệt`, hoặc `tìm user email@example.com`.',
    ].join('\n');
  }

  private extractQuery(message: string): string {
    return this.normalizeText(message)
      .replace(
        /\b(tim|kiem|tra|user|khach hang|bai do|bai xe|parking|email|thong tin|cua)\b/g,
        ' ',
      )
      .replace(/\s+/g, ' ')
      .trim();
  }

  private markdownTable(
    headers: string[],
    rows: Array<Array<string | number>>,
  ): string {
    if (!rows.length) return '_Kh\u00f4ng c\u00f3 d\u1eef li\u1ec7u ph\u00f9 h\u1ee3p._';
    const header = `| ${headers.join(' | ')} |`;
    const divider = `| ${headers.map(() => '---').join(' | ')} |`;
    const body = rows.map(
      (row) => `| ${row.map((cell) => String(cell)).join(' | ')} |`,
    );
    return [header, divider, ...body].join('\n');
  }

  private money(value: number): string {
    return `${Number(value || 0).toLocaleString('vi-VN')}\u0111`;
  }

  private extractLimit(message: string, fallback = 10): number {
    const match = this.normalizeText(message).match(
      /\btop\s*(\d{1,2})\b|\b(\d{1,2})\s*(bai|ket qua|parking)\b/,
    );
    const value = Number(match?.[1] || match?.[2] || fallback);
    return Math.min(Math.max(value || fallback, 1), 20);
  }

  private async getParkingRanking(message: string): Promise<AdminChatResult> {
    const text = this.normalizeText(message);
    const limit = this.extractLimit(message);
    const orderBy = this.includesAny(text, ['mac nhat', 'dat nhat', 'gia cao'])
      ? 'hourly_rate DESC NULLS LAST'
      : this.includesAny(text, ['re nhat', 'gia re'])
        ? 'hourly_rate ASC NULLS LAST'
        : this.includesAny(text, ['nhieu cho', 'cho trong'])
          ? 'pl.available_slots DESC NULLS LAST'
          : 'avg_rating DESC NULLS LAST';
    const title = orderBy.includes('hourly_rate DESC')
      ? `Top ${limit} b\u00e3i c\u00f3 gi\u00e1 cao nh\u1ea5t`
      : orderBy.includes('hourly_rate ASC')
        ? `Top ${limit} b\u00e3i gi\u00e1 r\u1ebb nh\u1ea5t`
        : orderBy.includes('available_slots')
          ? `Top ${limit} b\u00e3i c\u00f2n nhi\u1ec1u ch\u1ed7 tr\u1ed1ng nh\u1ea5t`
          : `Top ${limit} b\u00e3i \u0111\u01b0\u1ee3c \u0111\u00e1nh gi\u00e1 cao nh\u1ea5t`;

    const rows = await this.dataSource.query(
      `SELECT pl.id,
              pl.name,
              pl.address,
              pl.status,
              pl.available_slots,
              pl.total_slots,
              COALESCE(ROUND(AVG(r.rating)::numeric, 1), 0) as avg_rating,
              COUNT(r.id)::int as reviews,
              MIN(pr.price_per_hour) as hourly_rate,
              u.email as owner_email
       FROM parking_lots pl
       LEFT JOIN users u ON u.id = pl.user_id
       LEFT JOIN reviews r ON r.parking_lot_id = pl.id
       LEFT JOIN parking_floors pf ON pf.parking_lot_id = pl.id
       LEFT JOIN parking_zones pz ON pz.parking_floor_id = pf.id
       LEFT JOIN pricing_rules pr ON pr.parking_zone_id = pz.id
       GROUP BY pl.id, pl.name, pl.address, pl.status, pl.available_slots, pl.total_slots, u.email
       ORDER BY ${orderBy}
       LIMIT $1`,
      [limit],
    );

    return {
      text:
        `## ${title}\n\n` +
        this.markdownTable(
          ['B\u00e3i \u0111\u1ed7', 'Ch\u1ed7 tr\u1ed1ng', 'Gi\u00e1/gi\u1edd', '\u0110\u00e1nh gi\u00e1', 'Review', 'Owner'],
          rows.map((row: any) => [
            row.name,
            `${row.available_slots ?? '-'}/${row.total_slots ?? '-'}`,
            this.money(Number(row.hourly_rate || 0)),
            row.avg_rating || 0,
            row.reviews || 0,
            row.owner_email || '-',
          ]),
        ),
      data: { action: 'admin_parking_ranking', rows },
    };
  }

  private async getOverview(): Promise<AdminChatResult> {
    const [users, lots, bookings, revenue] = await Promise.all([
      this.dataSource.query(`SELECT COUNT(*)::int as total FROM users`),
      this.dataSource.query(
        `SELECT status, COUNT(*)::int as total FROM parking_lots GROUP BY status`,
      ),
      this.dataSource.query(
        `SELECT status, COUNT(*)::int as total
         FROM bookings
         WHERE created_at >= CURRENT_DATE
         GROUP BY status`,
      ),
      this.dataSource.query(
        `SELECT COALESCE(SUM(total), 0) as total
         FROM invoices
         WHERE status = 'PAID' AND "createdAt" >= CURRENT_DATE`,
      ),
    ]);

    const lotRows = lots.map((row: any) => [row.status || 'UNKNOWN', row.total]);
    const bookingRows = bookings.map((row: any) => [
      row.status || 'UNKNOWN',
      row.total,
    ]);
    return {
      text:
        `## T\u1ed5ng Quan H\u1ec7 Th\u1ed1ng\n\n` +
        `- T\u1ed5ng user: **${users[0]?.total || 0}**\n` +
        `- Doanh thu h\u00f4m nay: **${this.money(Number(revenue[0]?.total || 0))}**\n\n` +
        `### B\u00e3i \u0111\u1ed7 theo tr\u1ea1ng th\u00e1i\n${this.markdownTable(['Tr\u1ea1ng th\u00e1i', 'S\u1ed1 l\u01b0\u1ee3ng'], lotRows)}\n\n` +
        `### Booking h\u00f4m nay\n${this.markdownTable(['Tr\u1ea1ng th\u00e1i', 'S\u1ed1 l\u01b0\u1ee3ng'], bookingRows)}`,
    };
  }

  private async searchUsers(message: string): Promise<AdminChatResult> {
    const query = this.extractQuery(message);
    if (!query) {
      return {
        text: 'B\u1ea1n mu\u1ed1n t\u00ecm user theo email, t\u00ean ho\u1eb7c m\u1ed9t ph\u1ea7n t\u1eeb kh\u00f3a n\u00e0o?',
      };
    }

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
      text: `## K\u1ebft Qu\u1ea3 T\u00ecm User\n\n${this.markdownTable(
        ['Email', 'T\u00ean', 'Role', 'Tr\u1ea1ng th\u00e1i'],
        rows.map((row: any) => [
          row.email,
          row.name || '-',
          row.roles || '-',
          row.status || '-',
        ]),
      )}`,
    };
  }

  private async searchParkingLots(message: string): Promise<AdminChatResult> {
    const query = this.extractQuery(message);
    if (!query) {
      return { text: 'B\u1ea1n mu\u1ed1n t\u00ecm b\u00e3i theo t\u00ean ho\u1eb7c \u0111\u1ecba ch\u1ec9 n\u00e0o?' };
    }

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
      text: `## K\u1ebft Qu\u1ea3 T\u00ecm B\u00e3i \u0110\u1ed7\n\n${this.markdownTable(
        ['B\u00e3i \u0111\u1ed7', 'Ch\u1ed7 tr\u1ed1ng', 'Tr\u1ea1ng th\u00e1i', 'Owner'],
        rows.map((row: any) => [
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
        ? `i."createdAt" >= CURRENT_DATE`
        : `i."createdAt" >= date_trunc('month', CURRENT_DATE)`;
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

    const title =
      period === 'today' ? 'Doanh Thu H\u00f4m Nay' : 'Doanh Thu Th\u00e1ng N\u00e0y';
    const total = rows.reduce(
      (sum: number, row: any) => sum + Number(row.revenue || 0),
      0,
    );
    return {
      text:
        `## ${title}\n\n` +
        `T\u1ed5ng doanh thu: **${this.money(total)}**\n\n` +
        this.markdownTable(
          ['B\u00e3i \u0111\u1ed7', 'Booking', 'Doanh thu'],
          rows.map((row: any) => [
            row.name,
            row.bookings,
            this.money(Number(row.revenue || 0)),
          ]),
        ),
    };
  }

  private async getPendingRequests(): Promise<AdminChatResult> {
    const rows = await this.dataSource.query(
      `SELECT r.type, r.status, u.email, r."createdAt"
       FROM system_requests r
       LEFT JOIN users u ON u.id = r."requesterId"
       WHERE r.status = $1
       ORDER BY r."createdAt" DESC
       LIMIT 10`,
      [RequestStatus.PENDING],
    );

    return {
      text: `## Y\u00eau C\u1ea7u Ch\u1edd Duy\u1ec7t\n\n${this.markdownTable(
        ['Lo\u1ea1i', 'Email', 'Ng\u00e0y t\u1ea1o'],
        rows.map((row: any) => [
          row.type || '-',
          row.email || '-',
          row.createdAt
            ? new Date(row.createdAt).toLocaleString('vi-VN')
            : '-',
        ]),
      )}`,
    };
  }

  private async getPaymentIssues(): Promise<AdminChatResult> {
    const rows = await this.dataSource.query(
      `SELECT i.status, i.total, u.email
       FROM invoices i
       LEFT JOIN bookings b ON b.id = i.booking_id
       LEFT JOIN users u ON u.id = b.user_id
       WHERE i.status <> 'PAID'
       ORDER BY i."createdAt" DESC
       LIMIT 10`,
    );

    return {
      text: `## H\u00f3a \u0110\u01a1n Ch\u01b0a Thanh To\u00e1n\n\n${this.markdownTable(
        ['Email', 'Tr\u1ea1ng th\u00e1i', 'S\u1ed1 ti\u1ec1n'],
        rows.map((row: any) => [
          row.email || '-',
          row.status || '-',
          this.money(Number(row.total || 0)),
        ]),
      )}`,
    };
  }

  private async getSystemAlerts(): Promise<AdminChatResult> {
    // Tổng hợp cảnh báo hệ thống để admin xử lý nhanh: request, invoice, payment lỗi, bãi gần hết chỗ.
    const [pendingRequests, unpaidInvoices, lowSlotLots, todayFailedPayments] = await Promise.all([
      this.dataSource.query(
        `SELECT COUNT(*)::int as total FROM system_requests WHERE status = $1`,
        [RequestStatus.PENDING],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int as total, COALESCE(SUM(total), 0) as amount
         FROM invoices
         WHERE status <> 'PAID'`,
      ),
      this.dataSource.query(
        `SELECT name, available_slots, total_slots
         FROM parking_lots
         WHERE status = 'ACTIVE'
           AND total_slots > 0
           AND available_slots <= GREATEST(2, CEIL(total_slots * 0.1))
         ORDER BY available_slots ASC
         LIMIT 5`,
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int as total
         FROM invoices
         WHERE status <> 'PAID' AND "createdAt" >= CURRENT_DATE`,
      ),
    ]);

    const alertRows = [
      ['Yêu cầu chờ duyệt', pendingRequests[0]?.total || 0, 'Nên xử lý để owner không bị chờ lâu'],
      ['Hóa đơn chưa PAID', unpaidInvoices[0]?.total || 0, `${this.money(Number(unpaidInvoices[0]?.amount || 0))} cần theo dõi`],
      ['Thanh toán lỗi hôm nay', todayFailedPayments[0]?.total || 0, 'Kiểm tra nếu tăng bất thường'],
      ['Bãi gần hết chỗ', lowSlotLots.length, 'Có thể cần điều phối hoặc khuyến nghị bãi khác'],
    ];

    const lowSlotText = lowSlotLots.length
      ? `\n\n### Bãi gần hết chỗ\n${this.markdownTable(['Bãi đỗ', 'Chỗ trống'], lowSlotLots.map((row: any) => [row.name, `${row.available_slots}/${row.total_slots}`]))}`
      : '';

    return {
      text:
        `## Cảnh Báo Hệ Thống\n\n` +
        this.markdownTable(['Mục', 'Số lượng', 'Gợi ý xử lý'], alertRows) +
        lowSlotText +
        `\n\nBạn có thể hỏi tiếp \`yêu cầu chờ duyệt\`, \`hóa đơn chưa thanh toán\`, hoặc \`top bãi còn nhiều chỗ trống\`.`,
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
      title: `[ADMIN] ${title || `Tra c\u1ee9u ${new Date().toLocaleDateString('vi-VN')}`}`,
      messages: [],
      isActive: true,
    });
    const saved = await this.sessionRepo.save(session);
    await this.pruneAdminSessions(userId);
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
    await this.sessionRepo.delete({
      id: sessionId,
      userId,
      title: Like('[ADMIN]%') as any,
    });
    return { success: true };
  }

  private async pruneAdminSessions(userId: string): Promise<void> {
    const sessions = await this.sessionRepo.find({
      where: { userId, title: Like('[ADMIN]%') },
      order: { updatedAt: 'DESC' },
      select: ['id', 'updatedAt'],
    });
    const oldSessions = sessions.slice(this.maxSessionsPerAdmin);
    if (!oldSessions.length) return;
    await Promise.all(
      oldSessions.map((session) =>
        this.sessionRepo.delete({ id: session.id, userId }),
      ),
    );
  }

  async processAdminMessageWithSession(
    messages: { role: string; content: string }[],
    userId: string,
    sessionId: string,
  ): Promise<any> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, userId, title: Like('[ADMIN]%') },
    });
    if (!session) return { text: 'Kh\u00f4ng t\u00ecm th\u1ea5y session admin.' };

    const fullHistory = [
      ...session.messages.map((m) => ({ role: m.role, content: m.content })),
      ...messages,
    ].slice(-20);
    const result = await this.processAdminMessage(fullHistory);
    const lastUser = messages.filter((m) => m.role === 'user').pop();
    const newMessages = [...session.messages];
    if (lastUser) {
      newMessages.push({
        role: 'user',
        content: lastUser.content,
        timestamp: Date.now(),
      });
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
