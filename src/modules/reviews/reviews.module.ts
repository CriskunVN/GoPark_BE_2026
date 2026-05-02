import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReviewsService } from './reviews.service';
import { ReviewsController } from './reviews.controller';
import { Review } from '../users/entities/review.entity';
import { Booking } from '../booking/entities/booking.entity';
import { ParkingLot } from '../parking-lot/entities/parking-lot.entity';
import { SupabaseModule } from '../../common/supabase/supabase.module';

@Module({
  imports: [TypeOrmModule.forFeature([Review, Booking, ParkingLot]), SupabaseModule],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
