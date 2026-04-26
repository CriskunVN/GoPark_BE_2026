import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ParkingZone } from './parking-zone.entity';
import { SlotStatus } from 'src/common/enums/status.enum';
import { Booking } from 'src/modules/booking/entities/booking.entity';

@Entity('parking_slots')
export class ParkingSlot {
  @PrimaryGeneratedColumn()
  @Index()
  id: number;

  @Column()
  code: string;

  @Column({
    type: 'enum',
    enum: SlotStatus,
    default: SlotStatus.AVAILABLE,
  })
  status: SlotStatus;

  @ManyToOne('ParkingZone', (zone: ParkingZone) => zone.slot, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'parking_zone_id' })
  parkingZone: ParkingZone;

}
