import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet } from './entities/wallet.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { Booking } from '../booking/entities/booking.entity';
import { BookingModule } from '../booking/booking.module';
import { ActivityModule } from '../activity/activity.module';
import { WalletAdminController } from './walletAdmin.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet, WalletTransaction, Booking]),
    ActivityModule,
    forwardRef(() => BookingModule),
  ],
  controllers: [WalletController, WalletAdminController],
  providers: [WalletService],
  exports: [TypeOrmModule, WalletService],
})
export class WalletModule {}
