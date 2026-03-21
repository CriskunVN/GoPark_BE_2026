import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ParkingLot } from './entities/parking-lot.entity';
import { ParkingSlot } from './entities/parking-slot.entity';
import { Gate } from './entities/gate.entity';
import { OwnerRequest } from './entities/owner-request.entity';
import { ParkingController } from './parking.controller';
import { ParkingService } from './parking.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ParkingLot, ParkingSlot, Gate, OwnerRequest]),
    UsersModule,
  ],
  controllers: [ParkingController],
  providers: [ParkingService],
  exports: [TypeOrmModule],
})
export class ParkingModule {}
