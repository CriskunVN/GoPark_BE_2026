import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './entities/payment.entity';
import { Invoice } from './entities/invoice.entity';
import { Transaction } from './entities/transaction.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Payment, Invoice, Transaction])],
  controllers: [],
  providers: [],
  exports: [TypeOrmModule],
})
export class PaymentModule {}
