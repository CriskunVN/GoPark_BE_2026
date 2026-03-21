import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
  OneToOne,
  CreateDateColumn,
} from 'typeorm';
import { PaymentStatus } from 'src/common/enums/status.enum';
import type { Booking } from '../../booking/entities/booking.entity';
import type { Transaction } from './transaction.entity';
import type { Invoice } from './invoice.entity';

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount: number;

  @Column()
  method: string; // VNPAY, VIETQR, WALLET

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.PENDING })
  status: PaymentStatus; // PENDING, PAID, FAILED, REFUNDED

  @CreateDateColumn()
  created_at: Date;

  @OneToMany('Transaction', (transaction: Transaction) => transaction.payment)
  transactions: Transaction[];

  @OneToOne('Invoice', (invoice: Invoice) => invoice.payment)
  invoice: Invoice;
}
