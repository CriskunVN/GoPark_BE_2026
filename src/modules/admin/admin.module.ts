import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { UsersModule } from '../users/users.module';
import { RequestModule } from '../request/request.module';
import { Request } from '../request/entities/request.entity';
import { ParkingModule } from '../parking-lot/parking-lot.module';
import { BookingModule } from '../booking/booking.module';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [
    UsersModule,
    RequestModule,
    ParkingModule,
    BookingModule,
    ActivityModule,
    TypeOrmModule.forFeature([Request]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
