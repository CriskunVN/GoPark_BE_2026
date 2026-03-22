import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from './entities/booking.entity';
import { QRCode } from './entities/qr-code.entity';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { ParkingSlot } from '../parking-lot/entities/parking-slot.entity';
import { ParkingFloor } from '../parking-lot/entities/parking-floor.entity';
import { ParkingZone } from '../parking-lot/entities/parking-zone.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Booking,
      QRCode,
      ParkingSlot,
      ParkingFloor,
      ParkingZone,
    ]),
  ],
  controllers: [BookingController],
  providers: [BookingService],
  exports: [TypeOrmModule],
})
export class BookingModule {}
