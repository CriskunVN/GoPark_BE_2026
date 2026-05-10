import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './entities/payment.entity';
import { Invoice } from './entities/invoice.entity';
import { Transaction } from './entities/transaction.entity';
import { VnpayService } from './vnpay.service';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { WalletModule } from '../wallet/wallet.module';
import { PricingRule } from './entities/pricingrule.entity';
import { BookingModule } from '../booking/booking.module';
import { VoucherModule } from '../voucher/voucher.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, Invoice, Transaction, PricingRule]),
    WalletModule, // Import WalletModule để sử dụng WalletService
    forwardRef(() => BookingModule),
    VoucherModule,
  ],
  controllers: [PaymentController],
  providers: [VnpayService, PaymentService],
  exports: [TypeOrmModule, VnpayService, PaymentService],
})
export class PaymentModule {}
