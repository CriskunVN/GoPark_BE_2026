import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ParkingLot } from './entities/parking-lot.entity';
import { ParkingSlot } from './entities/parking-slot.entity';
import { Gate } from './entities/gate.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ParkingLot, ParkingSlot, Gate])],
  controllers: [],
  providers: [],
  exports: [TypeOrmModule],
})
export class ParkingModule {}
