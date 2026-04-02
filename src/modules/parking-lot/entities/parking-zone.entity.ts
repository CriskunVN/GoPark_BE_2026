import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ParkingSlot } from './parking-slot.entity';
import { ParkingFloor } from './parking-floor.entity';

@Entity('parking_zones')
export class ParkingZone {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  zone_name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ default: 0 })
  total_slots: number;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @ManyToOne('ParkingFloor', (floor: ParkingFloor) => floor.parkingZone)
  @JoinColumn({ name: 'parking_floor_id' })
  parkingFloor: ParkingFloor;

  @OneToMany(
    'ParkingSlot',
    (parkingSlot: ParkingSlot) => parkingSlot.parkingZone,
  )
  slot: ParkingSlot[];
}
