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

  @Column()
  status: string; // PENDING, PAID, FAILED, REFUNDED

  @CreateDateColumn()
  created_at: Date;

  @ManyToOne('Booking', (booking: Booking) => booking.payments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'booking_id' })
  booking: Booking;

  @OneToMany('Transaction', (transaction: Transaction) => transaction.payment)
  transactions: Transaction[];

  @OneToOne('Invoice', (invoice: Invoice) => invoice.payment)
  invoice: Invoice;
}
