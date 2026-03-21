import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ParkingLot } from './entities/parking-lot.entity';
import { ParkingSlot } from './entities/parking-slot.entity';
import { Gate } from './entities/gate.entity';
import { ParkingFloor } from './entities/parking-floor.entity';
import { ParkingZone } from './entities/parking-zone.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ParkingLot, ParkingSlot, Gate, ParkingFloor, ParkingZone])],
  controllers: [],
  providers: [],
  exports: [TypeOrmModule],
})
export class ParkingModule {}
