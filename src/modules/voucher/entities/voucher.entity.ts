import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from 'src/common/entity/base.entity';
import {
  VoucherDiscountType,
  VoucherStatus,
} from 'src/common/enums/voucher.enum';
import type { UserVoucherUsage } from './user-voucher-usage.entity';
import type { Invoice } from '../../payment/entities/invoice.entity';

@Entity('vouchers')
export class Voucher extends BaseEntity {
  @Column({ unique: true })
  @Index()
  code: string;

  @Column({ type: 'enum', enum: VoucherDiscountType })
  discount_type: VoucherDiscountType;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  discount_value: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  max_discount_amount: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  min_booking_value: number;

  @Column({ type: 'int', default: 0 })
  usage_limit: number;

  @Column({ type: 'int', default: 0 })
  used_count: number;

  @Column({ type: 'timestamptz' })
  start_time: Date;

  @Column({ type: 'timestamptz' })
  end_time: Date;

  @Column({ type: 'enum', enum: VoucherStatus, default: VoucherStatus.ACTIVE })
  status: VoucherStatus;

  @OneToMany('UserVoucherUsage', (usage: UserVoucherUsage) => usage.voucher)
  usages: UserVoucherUsage[];

  @OneToMany('Invoice', (invoice: Invoice) => invoice.voucher)
  invoices: Invoice[];
}
