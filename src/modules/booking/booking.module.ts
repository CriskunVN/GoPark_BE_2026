import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from './entities/booking.entity';
import { QRCode } from './entities/qr-code.entity';
import { CheckInLog } from './entities/check-in-log.entity';
import { CheckOutLog } from './entities/check-out-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, QRCode, CheckInLog, CheckOutLog]),
  ],
  controllers: [],
  providers: [],
  exports: [TypeOrmModule],
})
export class BookingModule {}
