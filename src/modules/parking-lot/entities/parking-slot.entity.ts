import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ParkingZone } from './parking-zone.entity';
import { SlotStatus } from 'src/common/enums/status.enum';

@Entity('parking_slots')
export class ParkingSlot {
  @PrimaryGeneratedColumn()
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
