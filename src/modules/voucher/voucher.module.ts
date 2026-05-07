import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Voucher } from './entities/voucher.entity';
import { UserVoucherUsage } from './entities/user-voucher-usage.entity';
import { VoucherService } from './voucher.service';
import { VoucherController } from './voucher.controller';
import { AdminVoucherController } from './admin-voucher.controller';
import { VoucherCleanupService } from './voucher-cleanup.service';
import { Booking } from '../booking/entities/booking.entity';
import { Invoice } from '../payment/entities/invoice.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Voucher, UserVoucherUsage, Booking, Invoice]),
  ],
  controllers: [VoucherController, AdminVoucherController],
  providers: [VoucherService, VoucherCleanupService],
  exports: [VoucherService, VoucherCleanupService],
})
export class VoucherModule {}
