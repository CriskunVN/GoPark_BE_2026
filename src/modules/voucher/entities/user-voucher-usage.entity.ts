import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from 'src/common/entity/base.entity';
import type { User } from '../../users/entities/user.entity';
import type { Booking } from '../../booking/entities/booking.entity';
import type { Voucher } from './voucher.entity';

@Entity('user_voucher_usages')
@Index(['user_id', 'voucher_id'], { unique: true })
export class UserVoucherUsage extends BaseEntity {
  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid' })
  voucher_id: string;

  @Column({ type: 'int' })
  booking_id: number;

  @ManyToOne('User', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne('Voucher', (voucher: Voucher) => voucher.usages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'voucher_id' })
  voucher: Voucher;

  @ManyToOne('Booking', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booking_id' })
  booking: Booking;
}
