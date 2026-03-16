/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToOne,
  OneToMany,
} from 'typeorm';
import type { User } from '../../users/entities/user.entity';
import type { Vehicle } from '../../users/entities/vehicle.entity';
import type { ParkingLot } from '../../parking/entities/parking-lot.entity';
import type { ParkingSlot } from '../../parking/entities/parking-slot.entity';
import type { QRCode } from './qr-code.entity';
import type { CheckInLog } from './check-in-log.entity';
import type { CheckOutLog } from './check-out-log.entity';
import type { Payment } from '../../payment/entities/payment.entity';
import type { Invoice } from '../../payment/entities/invoice.entity';

@Entity('bookings')
export class Booking {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'timestamp' })
  start_time: Date;

  @Column({ type: 'timestamp' })
  end_time: Date;

  @Column()
  status: string;

  @ManyToOne('User', (user: User) => user.bookings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne('Vehicle', {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle: Vehicle;

  @ManyToOne('ParkingLot', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parking_lot_id' })
  parkingLot: ParkingLot;

  @ManyToOne('ParkingSlot', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'slot_id' })
  slot: ParkingSlot;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  @OneToOne('QRCode', (qrCode: QRCode) => qrCode.booking)
  qrCode: QRCode;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  @OneToMany('CheckInLog', (log: CheckInLog) => log.booking)
  checkInLogs: CheckInLog[];

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  @OneToMany('CheckOutLog', (log: CheckOutLog) => log.booking)
  checkOutLogs: CheckOutLog[];

  @OneToMany('Payment', (payment: Payment) => payment.booking)
  payments: Payment[];

  @OneToOne('Invoice', (invoice: Invoice) => invoice.booking)
  invoice: Invoice;
}
