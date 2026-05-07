import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import type { Booking } from '../../booking/entities/booking.entity';
import type { Payment } from './payment.entity';
import { BaseEntity } from 'src/common/entity/base.entity';
import { InvoiceStatus } from 'src/common/enums/status.enum';
import type { Voucher } from '../../voucher/entities/voucher.entity';

@Entity('invoices')
export class Invoice extends BaseEntity {
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  sub_total!: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  discount_amount!: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  total!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  tax!: number;

  @Column({
    type: 'enum',
    enum: InvoiceStatus,
    default: InvoiceStatus.PENDING,
  })
  status!: InvoiceStatus; // PENDING, PAID, CANCELED

  @Column({ type: 'text', nullable: true })
  file_url!: string | null;

  @ManyToOne('Booking', (booking: Booking) => booking.invoice, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'booking_id' })
  booking!: Booking;

  @ManyToOne('Voucher', (voucher: Voucher) => voucher.invoices, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'voucher_id' })
  voucher!: Voucher | null;

  @OneToMany('Payment', (payment: Payment) => payment.invoice)
  payment!: Payment[];
}
