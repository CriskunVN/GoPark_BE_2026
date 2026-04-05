import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import type { Booking } from './booking.entity';

@Entity('qrcodes')
export class QRCode {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  content: string;

  @Column()
  status: string;

  @OneToOne('Booking', (booking: Booking) => booking.qrCode,{cascade: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booking_id' })
  booking: Booking;
}
