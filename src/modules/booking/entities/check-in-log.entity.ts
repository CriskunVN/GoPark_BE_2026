import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type { Booking } from './booking.entity';
import type { Gate } from '../../parking/entities/gate.entity';

@Entity('check_in_logs')
export class CheckInLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'timestamp' })
  time: Date;

  @ManyToOne('Booking', (booking: Booking) => booking.checkInLogs)
  @JoinColumn({ name: 'booking_id' })
  booking: Booking;

  @ManyToOne('Gate')
  @JoinColumn({ name: 'gate_id' })
  gate: Gate;
}
