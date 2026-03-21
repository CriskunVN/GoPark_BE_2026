import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from './entities/booking.entity';
import { QRCode } from './entities/qr-code.entity';
import { CheckInLog } from './entities/check-in-log.entity';
import { CheckOutLog } from './entities/check-out-log.entity';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { ParkingSlot } from '../parking/entities/parking-slot.entity';
import { ParkingFloor } from '../parking/entities/parking-floor.entity';
import { ParkingZone } from '../parking/entities/parking-zone.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, QRCode, CheckInLog, CheckOutLog,ParkingSlot,ParkingFloor,ParkingZone]),
  ],
  controllers: [BookingController],
  providers: [BookingService],
  exports: [TypeOrmModule],
})
export class BookingModule {}
