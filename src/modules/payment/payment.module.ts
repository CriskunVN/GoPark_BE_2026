import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './entities/payment.entity';
import { Invoice } from './entities/invoice.entity';
import { Transaction } from './entities/transaction.entity';
import { VnpayService } from './vnpay.service';
import { PaymentController } from './payment.controller';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, Invoice, Transaction]),
    WalletModule, // Import WalletModule để sử dụng WalletService
  ],
  controllers: [PaymentController],
  providers: [VnpayService],
  exports: [TypeOrmModule, VnpayService],
})
export class PaymentModule {}
