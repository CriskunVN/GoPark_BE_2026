import { AdminChatbotService } from './admin-chatbot.service';

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

describe('AdminChatbotService', () => {
  function createService(query: jest.Mock) {
    return new AdminChatbotService({ query } as any, createSessionRepoMock());
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('queries pending requests with a valid enum parameter and hides request ids', async () => {
    const query = jest.fn().mockResolvedValueOnce([
      {
        type: 'OWNER_REGISTRATION',
        status: 'PENDING',
        email: 'owner@example.com',
        createdAt: '2026-05-17T03:00:00.000Z',
      },
    ]);
    const service = createService(query);

    const response = await service.processAdminMessage([
      { role: 'user', content: 'yeu cau cho duyet' },
    ]);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE r.status = $1'),
      ['PENDING'],
    );
    expect(query.mock.calls[0][0]).not.toContain("'pending'");
    expect(query.mock.calls[0][0]).not.toContain('r.id');
    expect(response.text).toContain('## Yêu Cầu Chờ Duyệt');
    expect(response.text).toContain('| Loại | Email | Ngày tạo |');
    expect(response.text).toContain('owner@example.com');
    expect(response.text).not.toContain('| ID |');
  });

  it('routes top parking availability prompts to parking ranking without ids', async () => {
    const query = jest.fn().mockResolvedValueOnce([
      {
        id: 11,
        name: 'GoPark My Khe',
        available_slots: 18,
        total_slots: 40,
        hourly_rate: 12000,
        avg_rating: 4.5,
        reviews: 9,
        owner_email: 'owner@example.com',
      },
    ]);
    const service = createService(query);

    const response = await service.processAdminMessage([
      { role: 'user', content: 'top 5 bai nhieu cho trong' },
    ]);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('pl.available_slots DESC NULLS LAST'),
      [5],
    );
    expect(response.text).toContain('Top 5 bãi còn nhiều chỗ trống nhất');
    expect(response.text).toContain('| Bãi đỗ | Chỗ trống | Giá/giờ | Đánh giá | Review | Owner |');
    expect(response.text).toContain('| GoPark My Khe | 18/40 | 12.000đ |');
    expect(response.text).not.toContain('| ID |');
    expect(response.text).not.toContain('| 11 | GoPark My Khe |');
  });

  it('returns readable admin help text when the prompt is unknown', async () => {
    const service = createService(jest.fn());

    const response = await service.processAdminMessage([
      { role: 'user', content: 'abc xyz' },
    ]);

    expect(response.text).toContain('Tôi có thể tra nhanh dữ liệu admin');
    expect(response.text).toContain('top 5 bãi nhiều chỗ trống');
    expect(response.text).not.toMatch(/Ãƒ|Ã¡Â»|Ã„/);
  });

  it('returns system alerts for admin risk prompts', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ total: 2 }])
      .mockResolvedValueOnce([{ total: 3, amount: 150000 }])
      .mockResolvedValueOnce([
        { name: 'GoPark My Khe', available_slots: 1, total_slots: 40 },
      ])
      .mockResolvedValueOnce([{ total: 1 }]);
    const service = createService(query);

    const response = await service.processAdminMessage([
      { role: 'user', content: 'canh bao he thong' },
    ]);

    expect(query).toHaveBeenCalledTimes(4);
    expect(response.text).toContain('PAID');
    expect(response.text).toContain('GoPark My Khe');
  });

  it('softly refuses clearly off-topic admin questions', async () => {
    const service = createService(jest.fn());

    const response = await service.processAdminMessage([
      { role: 'user', content: 'toi nen xem phim gi toi nay' },
    ]);

    expect(response.text).toContain('chỉ hỗ trợ');
    expect(response.text).toContain('cảnh báo hệ thống');
  });

  it('refuses code and HTML generation requests for admin chatbot', async () => {
    const service = createService(jest.fn());

    const response = await service.processAdminMessage([
      { role: 'user', content: 'hay viet code html hello world cho toi' },
    ]);

    expect(response.text).toContain('chỉ hỗ trợ');
    expect(response.text).toContain('viết code/HTML');
    expect(response.text).toContain('tổng quan hệ thống');
  });
});

