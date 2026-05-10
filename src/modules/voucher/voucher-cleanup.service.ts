import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, LessThan } from 'typeorm';
import { Booking } from '../booking/entities/booking.entity';
import { Invoice } from '../payment/entities/invoice.entity';
import { BookingStatus, InvoiceStatus } from 'src/common/enums/status.enum';
import { VoucherService } from './voucher.service';

@Injectable()
export class VoucherCleanupService {
  private readonly logger = new Logger(VoucherCleanupService.name);
  private readonly expireMinutes = Math.max(
    1,
    Number(process.env.BOOKING_PENDING_EXPIRE_MINUTES ?? 10) || 10,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly voucherService: VoucherService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleExpiredPendingBookings() {
    await this.cleanupExpiredPendingBookings();
  }

  // ======== Hàm này sẽ tìm kiếm tất cả các booking có trạng thái PENDING đã tạo cách đây hơn 10 phút (hoặc thời gian được cấu hình),
  // sau đó cập nhật trạng thái của chúng thành CANCELLED, đồng thời nếu có hóa đơn liên quan sẽ cập nhật trạng thái hóa đơn thành CANCELED,
  // và gọi hàm rollbackUsageForBooking để hoàn tác việc sử dụng mã giảm giá nếu booking đó đã áp dụng mã giảm giá nào. Cuối cùng, hàm sẽ log số lượng booking đã được làm sạch ========
  async cleanupExpiredPendingBookings() {
    const expiredTime = new Date(Date.now() - this.expireMinutes * 60 * 1000);

    return this.dataSource.transaction(async (manager) => {
      const bookingRepo = manager.getRepository(Booking);
      const invoiceRepo = manager.getRepository(Invoice);

      const expiredBookings = await bookingRepo.find({
        where: {
          status: BookingStatus.PENDING,
          created_at: LessThan(expiredTime),
        },
      });

      if (expiredBookings.length === 0) {
        return { cleaned: 0 };
      }

      for (const booking of expiredBookings) {
        await bookingRepo.update(booking.id, {
          status: BookingStatus.CANCELLED,
        });

        const invoice = await invoiceRepo.findOne({
          where: { booking: { id: booking.id } },
        });
        if (invoice) {
          invoice.status = InvoiceStatus.CANCELED;
          await invoiceRepo.save(invoice);
        }

        await this.voucherService.rollbackUsageForBooking(booking.id, manager);
      }

      this.logger.log(
        `Cleaned ${expiredBookings.length} expired pending bookings`,
      );

      return { cleaned: expiredBookings.length };
    });
  }
}
