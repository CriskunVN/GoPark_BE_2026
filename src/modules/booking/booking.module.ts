import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from './entities/booking.entity';
import { QRCode } from './entities/qr-code.entity';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { ParkingSlot } from '../parking-lot/entities/parking-slot.entity';
import { ParkingFloor } from '../parking-lot/entities/parking-floor.entity';
import { ParkingZone } from '../parking-lot/entities/parking-zone.entity';
import { CheckLog } from './entities/check-log.entity';
import { AuthModule } from '../auth/auth.module';
import { WalletModule } from '../wallet/wallet.module';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Booking,
      QRCode,
      ParkingSlot,
      ParkingFloor,
      ParkingZone,
      CheckLog,
    ]),
      AuthModule,
      ActivityModule,
      forwardRef(() => WalletModule),
  ],
  controllers: [BookingController],
  providers: [BookingService],
  exports: [TypeOrmModule, BookingService],
})
export class BookingModule {}
