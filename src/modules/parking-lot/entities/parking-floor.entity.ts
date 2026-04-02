import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ParkingZone } from './parking-zone.entity';
import { ParkingLot } from './parking-lot.entity';

@Entity('parking_floors')
export class ParkingFloor {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  floor_name: string;

  @Column()
  floor_number: number;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ default: 0 })
  total_slots: number;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @OneToMany('ParkingZone', (zone: ParkingZone) => zone.parkingFloor)
  parkingZone: ParkingZone[];

  @ManyToOne('ParkingLot', (lot: ParkingLot) => lot.parkingFloor)
  @JoinColumn({ name: 'parking_lot_id' })
  parkingLot: ParkingLot;
}
