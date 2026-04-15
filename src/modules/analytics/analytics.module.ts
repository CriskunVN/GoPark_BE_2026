import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { Booking } from '../booking/entities/booking.entity';
import { ParkingLot } from '../parking-lot/entities/parking-lot.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Booking, ParkingLot])],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
