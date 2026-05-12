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
import { NotificationModule } from '../notification/notification.module';
import { Transaction } from '../payment/entities/transaction.entity';
import { WalletTransaction } from '../wallet/entities/wallet-transaction.entity';

@Module({
  imports: [
    UsersModule,
    RequestModule,
    ParkingModule,
    BookingModule,
    ActivityModule,

    NotificationModule,
    TypeOrmModule.forFeature([Request, Transaction, WalletTransaction]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
