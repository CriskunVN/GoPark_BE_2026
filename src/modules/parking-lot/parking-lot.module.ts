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
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { Gate } from './entities/gate.entity';
import { PricingRule } from '../payment/entities/pricingrule.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ParkingLot,
      ParkingSlot,
      Booking,
      ParkingZone,
      ParkingFloor,
      Vehicle,
      Gate,
      PricingRule,
    ]),
    RequestModule,
    UsersModule,
  ],
  controllers: [ParkingLotController],
  providers: [ParkingLotService],
  exports: [TypeOrmModule, ParkingLotService],
})
export class ParkingModule {}
