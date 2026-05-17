import { OwnerChatbotService } from './owner-chatbot.service';

function createSessionRepoMock() {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => ({ id: 'session-1', ...value })),
    update: jest.fn(),
    delete: jest.fn(),
  } as any;
}

function createGuideMock() {
  return {
    getGuide: jest.fn(() => 'Owner chatbot guide.'),
  } as any;
}

describe('OwnerChatbotService analysis answers', () => {
  const ownerId = 'owner-1';

  beforeEach(() => {
    delete process.env.GROQ_API_KEY;
    delete process.env.GORQ_API_KEY;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createService() {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM parking_lots') && sql.includes('ORDER BY name ASC')) {
        return [
          { id: 1, name: 'GoPark My Khe', total_slots: 40, available_slots: 18, status: 'ACTIVE' },
          { id: 2, name: 'GoPark Nguyen Hue', total_slots: 30, available_slots: 9, status: 'ACTIVE' },
        ];
      }
      if (sql.includes('b.created_at >= CURRENT_DATE') && sql.includes('GROUP BY b.status')) {
        return [{ status: 'CONFIRMED', total: 3 }];
      }
      if (sql.includes('i."createdAt" >= CURRENT_DATE')) {
        return [{ total: 250000 }];
      }
      if (sql.includes('FROM system_requests') && sql.includes('GROUP BY status')) {
        return [{ status: 'PENDING', total: 1 }];
      }

      if (sql.includes('JOIN bookings b') && sql.includes("INTERVAL '30 days'")) {
        return [
          { name: 'GoPark My Khe', bookings: 32, revenue: 6400000 },
          { name: 'GoPark Nguyen Hue', bookings: 3, revenue: 450000 },
        ];
      }

      if (sql.includes('pl.available_slots') && sql.includes("INTERVAL '30 days'")) {
        return [
          {
            name: 'GoPark My Khe',
            available_slots: 18,
            total_slots: 40,
            bookings: 32,
            revenue: 6400000,
          },
          {
            name: 'GoPark Nguyen Hue',
            available_slots: 9,
            total_slots: 30,
            bookings: 3,
            revenue: 450000,
          },
        ];
      }

      return [];
    });

    return {
      query,
      service: new OwnerChatbotService(
        { query } as any,
        createGuideMock(),
        createSessionRepoMock(),
      ),
    };
  }

  it('adds interpretation and follow-up prompts to revenue reports', async () => {
    const { service } = createService();

    const response = await service.processOwnerMessage(
      [{ role: 'user', content: 'doanh thu thang nay' }],
      ownerId,
    );

    expect(response.text).toContain('Tổng doanh thu');
    expect(response.text).toContain('| Bãi đỗ | Số booking | Doanh thu |');
    expect(response.text).toContain('Nhận xét nhanh');
    expect(response.text).toContain('Bạn có thể hỏi tiếp');
    expect(response.chartData.suggestion).toContain('phân tích chi tiết doanh thu');
  });

  it('answers revenue detail follow-ups with analysis and actions', async () => {
    const { service } = createService();

    const response = await service.processOwnerMessage(
      [{ role: 'user', content: 'phan tich chi tiet doanh thu' }],
      ownerId,
    );

    expect(response.text).toContain('Phân Tích Chi Tiết Doanh Thu');
    expect(response.text).toContain('| Bãi đỗ | Booking | Doanh thu | Tỷ trọng | TB/booking |');
    expect(response.text).toContain('Đọc kết quả');
    expect(response.text).toContain('Gợi ý hành động');
    expect(response.chartData.suggestion).toContain('GoPark Nguyen Hue');
  });

  it('returns owner dashboard from operating data', async () => {
    const { service } = createService();

    const response = await service.processOwnerMessage(
      [{ role: 'user', content: 'dashboard hom nay bai cua toi' }],
      ownerId,
    );

    expect(response.text).toContain('Dashboard Vận Hành Hôm Nay');
    expect(response.text).toContain('Doanh thu hôm nay');
    expect(response.text).toContain('250.000đ');
    expect(response.text).toContain('Booking hôm nay');
  });

  it('softly refuses clearly off-topic owner questions', async () => {
    const { service } = createService();

    const response = await service.processOwnerMessage(
      [{ role: 'user', content: 'du bao thoi tiet ngay mai' }],
      ownerId,
    );

    expect(response.text).toContain('chỉ hỗ trợ');
    expect(response.text).toContain('dashboard hôm nay');
  });

  it('refuses code and HTML generation requests for owner chatbot', async () => {
    const { service } = createService();

    const response = await service.processOwnerMessage(
      [{ role: 'user', content: 'viet code html hello world cho toi' }],
      ownerId,
    );

    expect(response.text).toContain('chỉ hỗ trợ');
    expect(response.text).toContain('viết code/HTML');
    expect(response.text).toContain('doanh thu tháng này');
  });
});

