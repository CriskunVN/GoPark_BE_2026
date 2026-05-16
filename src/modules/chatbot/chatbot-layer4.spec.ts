jest.mock('../parking-lot/entities/parking-lot.entity', () => ({
  ParkingLot: class ParkingLot {},
}));

import { ChatbotService } from './chatbot.service';
import { ChatbotStateService } from './chatbot-state.service';
import { OwnerChatbotService } from './owner-chatbot.service';
import { AdminChatbotService } from './admin-chatbot.service';

const userId = 'user-1';
const ownerId = 'owner-1';

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
    getGuide: jest.fn(() => 'Chatbot can use knowledgebase markdown instructions.'),
  } as any;
}

describe('Chatbot layer 4 behavior', () => {
  const parkingLots = [
    {
      id: 11,
      name: 'GoPark My Khe',
      address: 'Vo Nguyen Giap, Da Nang',
      available_slots: 18,
      total_slots: 40,
    },
    {
      id: 12,
      name: 'GoPark Nguyen Hue',
      address: 'Quan 1, TP HCM',
      available_slots: 9,
      total_slots: 30,
    },
  ];

  const vehicles = [
    { id: 21, plate_number: '51F-888.38', type: 'car' },
    { id: 22, plate_number: '43A-123.45', type: 'car' },
  ];

  beforeEach(() => {
    delete process.env.GROQ_API_KEY;
    delete process.env.GORQ_API_KEY;
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-16T12:00:00+07:00'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('user chatbot booking flow', () => {
    function createUserChatbot() {
      const service = new ChatbotService(
        { query: jest.fn() } as any,
        new ChatbotStateService(),
        createGuideMock(),
        createSessionRepoMock(),
      );

      (service as any).getParkingLotsRaw = jest.fn(async () => parkingLots);
      (service as any).getUserVehicles = jest.fn(async () => ({ vehicles }));
      (service as any).getWalletBalance = jest.fn(async () => ({ balance: 125000 }));
      (service as any).getUserBookings = jest.fn(async () => ({
        bookings: [
          {
            lot_name: 'GoPark My Khe',
            start_time: '2026-05-17T08:00:00.000Z',
            end_time: '2026-05-17T10:00:00.000Z',
            status: 'CONFIRMED',
          },
        ],
      }));
      return service;
    }

    it('keeps multi-turn booking context and does not parse "bai 1" as 01:00', async () => {
      const service = createUserChatbot();

      const first = await service.processMessage([{ role: 'user', content: 'dat bai' }], userId);
      expect(first.action).toBe('collect_booking');
      expect(first.data.missing).toEqual(
        expect.arrayContaining(['ten bai do', 'thoi gian vao/ra', 'xe hoac bien so']),
      );
      expect(first.data.nextField).toBe('ten bai do');
      expect(first.text).toContain('| Bai 1 | Bai do #11 | - |');
      expect(first.text).not.toContain('| Xe 1 | 51F-888.38 |');

      const chooseLot = await service.processMessage([{ role: 'user', content: 'bai 1' }], userId);
      expect(chooseLot.action).toBe('collect_booking');
      expect(chooseLot.data.pendingBooking.parkingLotId).toBe('11');
      expect(chooseLot.data.pendingBooking.startTime).toBeUndefined();
      expect(chooseLot.data.pendingBooking.endTime).toBeUndefined();
      expect(chooseLot.data.missing).toEqual(expect.arrayContaining(['thoi gian vao/ra']));
      expect(chooseLot.data.nextField).toBe('thoi gian vao/ra');

      const chooseTime = await service.processMessage(
        [{ role: 'user', content: 'ngay mai tu 8h den 10h' }],
        userId,
      );
      expect(chooseTime.action).toBe('collect_booking');
      expect(chooseTime.data.pendingBooking.startTime).toContain('T08:00');
      expect(chooseTime.data.pendingBooking.endTime).toContain('T10:00');
      expect(chooseTime.data.missing).toEqual(expect.arrayContaining(['xe hoac bien so']));
      expect(chooseTime.data.nextField).toBe('xe hoac bien so');

      const chooseVehicle = await service.processMessage([{ role: 'user', content: 'xe 1' }], userId);
      expect(chooseVehicle.action).toBe('redirect');
      expect(chooseVehicle.redirectUrl).toContain('/users/myBooking/11?');
      expect(chooseVehicle.redirectUrl).toContain('vehicle=51F-888.38');
      expect(chooseVehicle.redirectUrl).toContain('start=2026-05-17T08%3A00');
      expect(chooseVehicle.redirectUrl).toContain('end=2026-05-17T10%3A00');
    });

    it('answers user data questions with readable markdown tables', async () => {
      const service = createUserChatbot();

      const vehiclesResponse = await service.processMessage(
        [{ role: 'user', content: 'xe cua toi' }],
        userId,
      );
      expect(vehiclesResponse.text).toContain('| xe 1 | 51F-888.38 | car |');

      const walletResponse = await service.processMessage(
        [{ role: 'user', content: 'so du vi cua toi' }],
        userId,
      );
      expect(walletResponse.text).toContain('125.000');
      const bookingsResponse = await service.processMessage(
        [{ role: 'user', content: 'lich su dat cua toi' }],
        userId,
      );
      expect(bookingsResponse.text).toContain('GoPark My Khe');
    });
  });

  describe('owner chatbot data flow', () => {
    function createOwnerChatbot() {
      const query = jest.fn(async (sql: string, params?: any[]) => {
        if (sql.includes('FROM parking_lots') && sql.includes('ORDER BY name ASC')) {
          return parkingLots;
        }
        if (sql.includes('COUNT(DISTINCT pf.id)') && params?.[1] === 11) {
          return [
            {
              id: 11,
              name: 'GoPark My Khe',
              address: 'Vo Nguyen Giap, Da Nang',
              status: 'ACTIVE',
              total_slots: 40,
              available_slots: 18,
              floors: 2,
              zones: 4,
              slots: 40,
              bookings_30d: 32,
              revenue_30d: 6400000,
            },
          ];
        }
        if (sql.includes('ORDER BY revenue DESC') && sql.includes("INTERVAL '30 days'")) {
          return [
            { name: 'GoPark My Khe', bookings: 32, revenue: 6400000 },
            { name: 'GoPark Nguyen Hue', bookings: 12, revenue: 2100000 },
          ];
        }
        if (sql.includes('LEFT JOIN parking_floors') && sql.includes('GROUP BY pl.id')) {
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

      return new OwnerChatbotService(
        { query } as any,
        createGuideMock(),
        createSessionRepoMock(),
      );
    }

    it('lets owner select long parking lot names by numbered option', async () => {
      const service = createOwnerChatbot();

      const ask = await service.processOwnerMessage(
        [{ role: 'user', content: 'xem thong tin bai' }],
        ownerId,
      );
      expect(ask.text).toContain('Bãi 1: GoPark My Khe');

      const answer = await service.processOwnerMessage([{ role: 'user', content: 'bai 1' }], ownerId);
      expect(answer.text).toContain('GoPark My Khe');
      expect(answer.text).toContain('18/40');
      expect(answer.data.action).toBe('parking_info');
      expect(answer.data.lot.availableSlots).toBe(18);
    });

    it('returns owner revenue and improvement analysis as markdown data answers', async () => {
      const service = createOwnerChatbot();

      const revenue = await service.processOwnerMessage(
        [{ role: 'user', content: 'doanh thu thang nay' }],
        ownerId,
      );
      expect(revenue.text).toContain('| Bai do | So booking | Doanh thu |');
      expect(revenue.text).toContain('| GoPark My Khe | 32 | 6.400.000đ |');
      expect(revenue.chartData.action).toBe('revenue_chart');

      const suggestion = await service.processOwnerMessage(
        [{ role: 'user', content: 'goi y tang doanh thu' }],
        ownerId,
      );
      expect(suggestion.text).toContain('| Bai do | Booking 30 ngay | Doanh thu |');
      expect(suggestion.text).toContain('GoPark Nguyen Hue');
      expect(suggestion.text).toContain('Can uu tien');
      expect(suggestion.chartData.suggestion).toContain('GoPark Nguyen Hue');
    });
  });

  describe('admin chatbot data flow', () => {
    function createAdminChatbot(query: jest.Mock) {
      return new AdminChatbotService({ query } as any, createSessionRepoMock());
    }

    it('summarizes system overview with markdown tables', async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce([{ total: 10 }])
        .mockResolvedValueOnce([
          { status: 'ACTIVE', total: 6 },
          { status: 'PENDING', total: 2 },
        ])
        .mockResolvedValueOnce([{ status: 'CONFIRMED', total: 4 }])
        .mockResolvedValueOnce([{ total: 980000 }]);
      const service = createAdminChatbot(query);

      const response = await service.processAdminMessage([
        { role: 'user', content: 'tong quan he thong' },
      ]);

      expect(response.text).toContain('10');
      expect(response.text).toContain('980.000đ');
      expect(response.text).toContain('| Trạng thái | Số lượng |');
      expect(response.text).toContain('| ACTIVE | 6 |');
      expect(response.text).toContain('| CONFIRMED | 4 |');
    });

    it('searches users and revenue with markdown data answers', async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce([
          {
            email: 'nguyendung17032005@gmail.com',
            name: 'Nguyen Dung',
            roles: 'USER',
            status: 'ACTIVE',
          },
        ])
        .mockResolvedValueOnce([
          { name: 'GoPark My Khe', bookings: 7, revenue: 1400000 },
        ]);
      const service = createAdminChatbot(query);

      const users = await service.processAdminMessage([
        { role: 'user', content: 'tim user nguyendung' },
      ]);
      expect(users.text).toContain('| Email | Tên | Role | Trạng thái |');
      expect(users.text).toContain('nguyendung17032005@gmail.com');

      const revenue = await service.processAdminMessage([
        { role: 'user', content: 'doanh thu hom nay' },
      ]);
      expect(revenue.text).toContain('| Bãi đỗ | Booking | Doanh thu |');
      expect(revenue.text).toContain('| GoPark My Khe | 7 | 1.400.000đ |');
    });
  });
});
