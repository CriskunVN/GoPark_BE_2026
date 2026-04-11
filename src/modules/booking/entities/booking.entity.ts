import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToOne,
  OneToMany,
  CreateDateColumn,
  Index,
} from 'typeorm';
import type { User } from '../../users/entities/user.entity';
import type { Vehicle } from '../../users/entities/vehicle.entity';
import type { ParkingSlot } from '../../parking-lot/entities/parking-slot.entity';
import { QRCode } from './qr-code.entity';
import { Invoice } from '../../payment/entities/invoice.entity';
import { CheckLog } from './check-log.entity';
import { Review } from 'src/modules/users/entities/review.entity';
import { BookingStatus } from 'src/common/enums/status.enum';

@Entity('bookings')
export class Booking {
  @PrimaryGeneratedColumn()
  @Index()
  id: number;

  @Column({ type: 'timestamp' })
  start_time: Date;

  @Column({ type: 'timestamp' })
  end_time: Date;

  @Column({
    type:'enum',
    enum:BookingStatus,
    default:BookingStatus.PENDING,
  })
  status: BookingStatus;

  @CreateDateColumn({
    type: 'timestamp',
    nullable: true,
    default: () => 'CURRENT_TIMESTAMP',
  })
  created_at: Date;

  @ManyToOne('User', (user: User) => user.bookings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne('Vehicle', {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle: Vehicle;

  @ManyToOne('ParkingSlot', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'slot_id' })
  slot: ParkingSlot;

  @OneToOne('QRCode', (qrCode: QRCode) => qrCode.booking)
  qrCode: QRCode;

  @OneToMany('Invoice', (invoice: Invoice) => invoice.booking)
  invoice: Invoice[];

  @OneToMany('CheckLog', (checkout: CheckLog) => checkout.booking)
  checkout: CheckLog[];

  @OneToMany('Review', (review: Review) => review.booking)
  review: Review;
}
