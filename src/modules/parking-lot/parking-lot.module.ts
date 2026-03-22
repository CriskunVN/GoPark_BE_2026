import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ParkingLot } from './entities/parking-lot.entity';
import { ParkingSlot } from './entities/parking-slot.entity';

import { ParkingFloor } from './entities/parking-floor.entity';
import { ParkingZone } from './entities/parking-zone.entity';
import { Booking } from '../booking/entities/booking.entity';
import { ParkingLotController } from './parking-lot.controller';
import { ParkingLotService } from './parking-lot.service';
import { RequestModule } from '../request/request.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ParkingLot,
      ParkingSlot,
      Booking,
      ParkingZone,
      ParkingFloor,
    ]),
    RequestModule,
    UsersModule,
  ],
  controllers: [ParkingLotController],
  providers: [ParkingLotService],
  exports: [TypeOrmModule],
})
export class ParkingModule {}
