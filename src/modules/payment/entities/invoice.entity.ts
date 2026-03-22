import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import type { Booking } from '../../booking/entities/booking.entity';
import type { Payment } from './payment.entity';
import { BaseEntity } from 'src/common/entity/base.entity';
import { InvoiceStatus } from 'src/common/enums/status.enum';

@Entity('invoices')
export class Invoice extends BaseEntity {
  @Column({ type: 'decimal', precision: 15, scale: 2 })
  total: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  tax: number;

  @Column({
    type: 'enum',
    enum: InvoiceStatus,
    default: InvoiceStatus.PENDING,
  })
  status: InvoiceStatus; // PENDING, PAID, CANCELED

  @Column({ nullable: true })
  file_url: string;

  @ManyToOne('Booking', (booking: Booking) => booking.invoice, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'booking_id' })
  booking: Booking;

  @OneToMany('Payment', (payment: Payment) => payment.invoice)
  payment: Payment[];
}
