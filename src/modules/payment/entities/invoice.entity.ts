import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import type { Booking } from '../../booking/entities/booking.entity';
import type { Payment } from './payment.entity';

@Entity('invoices')
export class Invoice {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  total: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  tax: number;

  @Column({ nullable: true })
  file_url: string;

  @OneToOne('Booking', (booking: Booking) => booking.invoice)
  @JoinColumn({ name: 'booking_id' })
  booking: Booking;

  @OneToOne('Payment', (payment: Payment) => payment.invoice)
  @JoinColumn({ name: 'payment_id' })
  payment: Payment;
}
