import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Booking } from '../booking/entities/booking.entity';
import { ParkingLot } from '../parking-lot/entities/parking-lot.entity';
import {
  InvoiceStatus,
  BookingStatus,
  SlotStatus,
} from 'src/common/enums/status.enum';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    @InjectRepository(ParkingLot)
    private readonly parkingLotRepository: Repository<ParkingLot>,
  ) {}

  async getDashboardSummary(ownerId: string) {
    const [overview, revenueChart, parkingOccupancy, recentActivities, alerts] =
      await Promise.all([
        this.getOverviewMetrics(ownerId),
        this.getRevenueChart14Days(ownerId),
        this.getParkingOccupancy(ownerId),
        this.getRecentActivities(ownerId),
        this.getAlerts(ownerId),
      ]);

    return {
      overview,
      revenueChart,
      parkingOccupancy,
      recentActivities,
      alerts,
    };
  }

  private async getOverviewMetrics(ownerId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // 1. Doanh thu hôm nay
    const todayData = await this.bookingRepository
      .createQueryBuilder('b')
      .leftJoin('b.invoice', 'i')
      .leftJoin('b.slot', 's')
      .leftJoin('s.parkingZone', 'z')
      .leftJoin('z.parkingFloor', 'f')
      .leftJoin('f.parkingLot', 'l')
      .leftJoin('l.owner', 'owner')
      .where('owner.id = :ownerId', { ownerId })
      .andWhere('b.start_time >= :start AND b.start_time < :end', {
        start: today,
        end: tomorrow,
      })
      .andWhere('i.status = :status', { status: InvoiceStatus.PAID })
      .select('SUM(i.total)', 'total')
      .getRawOne();

    // 2. Doanh thu hôm qua (để tính growth)
    const yesterdayData = await this.bookingRepository
      .createQueryBuilder('b')
      .leftJoin('b.invoice', 'i')
      .leftJoin('b.slot', 's')
      .leftJoin('s.parkingZone', 'z')
      .leftJoin('z.parkingFloor', 'f')
      .leftJoin('f.parkingLot', 'l')
      .leftJoin('l.owner', 'owner')
      .where('owner.id = :ownerId', { ownerId })
      .andWhere('b.start_time >= :start AND b.start_time < :end', {
        start: yesterday,
        end: today,
      })
      .andWhere('i.status = :status', { status: InvoiceStatus.PAID })
      .select('SUM(i.total)', 'total')
      .getRawOne();

    const todayRevenue = parseFloat(todayData?.total || '0');
    const yesterdayRevenue = parseFloat(yesterdayData?.total || '0');

    let revenueGrowth = 0;
    if (yesterdayRevenue > 0) {
      revenueGrowth =
        ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100;
    } else if (todayRevenue > 0) {
      revenueGrowth = 100;
    }

    // 3. Lượt gửi xe hôm nay
    const todayBookings = await this.bookingRepository
      .createQueryBuilder('b')
      .leftJoin('b.slot', 's')
      .leftJoin('s.parkingZone', 'z')
      .leftJoin('z.parkingFloor', 'f')
      .leftJoin('f.parkingLot', 'l')
      .leftJoin('l.owner', 'owner')
      .where('owner.id = :ownerId', { ownerId })
      .andWhere('b.start_time >= :start AND b.start_time < :end', {
        start: today,
        end: tomorrow,
      })
      .getCount();

    // 4. Lượt gửi xe hôm qua (để tính growth)
    const yesterdayBookings = await this.bookingRepository
      .createQueryBuilder('b')
      .leftJoin('b.slot', 's')
      .leftJoin('s.parkingZone', 'z')
      .leftJoin('z.parkingFloor', 'f')
      .leftJoin('f.parkingLot', 'l')
      .leftJoin('l.owner', 'owner')
      .where('owner.id = :ownerId', { ownerId })
      .andWhere('b.start_time >= :start AND b.start_time < :end', {
        start: yesterday,
        end: today,
      })
      .getCount();

    let bookingsGrowth = 0;
    if (yesterdayBookings > 0) {
      bookingsGrowth =
        ((todayBookings - yesterdayBookings) / yesterdayBookings) * 100;
    } else if (todayBookings > 0) {
      bookingsGrowth = 100;
    }

    // 5. Lấp đầy trung bình
    const lots = await this.parkingLotRepository
      .createQueryBuilder('l')
      .where('l.user_id = :ownerId', { ownerId })
      .getMany();

    let totalCapacity = 0;
    let totalOccupied = 0;
    for (const lot of lots) {
      totalCapacity += lot.total_slots || 0;
      totalOccupied += (lot.total_slots || 0) - (lot.available_slots || 0);
    }
    const averageOccupancy =
      totalCapacity > 0 ? (totalOccupied / totalCapacity) * 100 : 0;
    const occupancyGrowth = 0; // Tạm thời để 0 hoặc bỏ qua

    // 6. Số khách hàng mới (số user có lịch sử tạo booking đầu tiên vào hôm nay)
    const newCustomersCountObj = await this.bookingRepository
      .createQueryBuilder('b')
      .leftJoin('b.slot', 's')
      .leftJoin('s.parkingZone', 'z')
      .leftJoin('z.parkingFloor', 'f')
      .leftJoin('f.parkingLot', 'l')
      .leftJoin('l.owner', 'owner')
      .where('owner.id = :ownerId', { ownerId })
      .andWhere((qb) => {
        const subQuery = qb
          .subQuery()
          .select('b2.user_id')
          .from(Booking, 'b2')
          .groupBy('b2.user_id')
          .having('MIN(b2.created_at) >= :start AND MIN(b2.created_at) < :end')
          .getQuery();
        return 'b.user_id IN ' + subQuery;
      })
      .setParameter('start', today)
      .setParameter('end', tomorrow)
      .select('COUNT(DISTINCT b.user_id)', 'count')
      .getRawOne();

    const newCustomers = parseInt(newCustomersCountObj?.count || '0', 10);
    const customersGrowth = 0; // Có thể phát triển tỷ lệ khách hàng mới sau

    return {
      todayRevenue,
      revenueGrowth: parseFloat(revenueGrowth.toFixed(1)),
      todayBookings,
      bookingsGrowth: parseFloat(bookingsGrowth.toFixed(1)),
      averageOccupancy: Math.round(averageOccupancy),
      occupancyGrowth,
      newCustomers,
      customersGrowth,
    };
  }

  private async getRevenueChart14Days(ownerId: string) {
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const startDay = new Date();
    startDay.setDate(today.getDate() - 13);
    startDay.setHours(0, 0, 0, 0);

    const rawData = await this.bookingRepository
      .createQueryBuilder('b')
      .leftJoin('b.invoice', 'i')
      .leftJoin('b.slot', 's')
      .leftJoin('s.parkingZone', 'z')
      .leftJoin('z.parkingFloor', 'f')
      .leftJoin('f.parkingLot', 'l')
      .leftJoin('l.owner', 'owner')
      .where('owner.id = :ownerId', { ownerId })
      .andWhere('b.start_time >= :start AND b.start_time <= :end', {
        start: startDay,
        end: today,
      })
      .andWhere('i.status = :status', { status: InvoiceStatus.PAID })
      .select('DATE(b.start_time)', 'date')
      .addSelect('SUM(i.total)', 'revenue')
      .groupBy('DATE(b.start_time)')
      .orderBy('DATE(b.start_time)', 'ASC')
      .getRawMany();

    // Map dữ liệu vào 14 ngày
    const chart: { date: string; revenue: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(startDay);
      d.setDate(startDay.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];

      const found = rawData.find((r) => {
        const rawDate = new Date(r.date);
        // Chỉnh Date timezone issue by comparing YYYY-MM-DD
        return (
          rawDate.toISOString().split('T')[0] === dateStr ||
          new Date(r.date).toLocaleDateString('en-CA') === dateStr
        );
      });

      chart.push({
        date: dateStr,
        revenue: found ? parseFloat(found.revenue) : 0,
      });
    }

    return chart;
  }

  private async getParkingOccupancy(ownerId: string) {
    const lots = await this.parkingLotRepository
      .createQueryBuilder('l')
      .where('l.user_id = :ownerId', { ownerId })
      .getMany();

    return lots.map((lot) => {
      const capacity = lot.total_slots || 0;
      const available = lot.available_slots || 0;
      return {
        lotId: lot.id,
        name: lot.name,
        capacity,
        occupied: capacity - available,
      };
    });
  }

  private async getRecentActivities(ownerId: string) {
    const recent = await this.bookingRepository
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.vehicle', 'vehicle')
      .leftJoinAndSelect('b.slot', 'slot')
      .leftJoinAndSelect('slot.parkingZone', 'zone')
      .leftJoinAndSelect('zone.parkingFloor', 'floor')
      .leftJoinAndSelect('floor.parkingLot', 'parkingLot')
      .leftJoin('parkingLot.owner', 'owner')
      .where('owner.id = :ownerId', { ownerId })
      .orderBy('b.created_at', 'DESC')
      .take(10)
      .getMany();

    return recent.map((r) => ({
      id: r.id,
      vehicle: r.vehicle?.plate_number || 'N/A',
      status: r.status,
      time: r.start_time,
      lotName: r.slot?.parkingZone?.parkingFloor?.parkingLot?.name || 'N/A',
    }));
  }

  private async getAlerts(ownerId: string) {
    const now = new Date();
    // Overstay: status ONGOING và end_time < now
    const overstays = await this.bookingRepository
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.vehicle', 'vehicle')
      .leftJoinAndSelect('b.slot', 'slot')
      .leftJoinAndSelect('slot.parkingZone', 'zone')
      .leftJoinAndSelect('zone.parkingFloor', 'floor')
      .leftJoinAndSelect('floor.parkingLot', 'parkingLot')
      .leftJoin('parkingLot.owner', 'owner')
      .where('owner.id = :ownerId', { ownerId })
      .andWhere('b.status = :status', { status: BookingStatus.ONGOING })
      .andWhere('b.end_time < :now', { now })
      .getMany();

    return overstays.map((b) => {
      const msOver = now.getTime() - new Date(b.end_time).getTime();
      const hoursOver = Math.floor(msOver / (1000 * 60 * 60));
      return {
        id: b.id,
        vehicle: b.vehicle?.plate_number || 'N/A',
        issue: 'OVERSTAY',
        lotName: b.slot?.parkingZone?.parkingFloor?.parkingLot?.name || 'N/A',
        overstayHours: hoursOver,
        message: `Có 1 xe tại ${b.slot?.parkingZone?.parkingFloor?.parkingLot?.name || 'bãi'} đã đỗ quá giờ ${hoursOver} tiếng. Vui lòng kiểm tra.`,
      };
    });
  }

  // ============= Admin Analytics Stats =============
  async getAnalyticsStats() {}
}
