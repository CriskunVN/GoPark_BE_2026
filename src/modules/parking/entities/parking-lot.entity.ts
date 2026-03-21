import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type { ParkingSlot } from './parking-slot.entity';
import type { Gate } from './gate.entity';
import type { User } from '../../users/entities/user.entity';
import { ParkingFloor } from './parking-floor.entity';

@Entity('parking_lots')
export class ParkingLot {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column()
  address: string;

  @Column({ type: 'decimal', precision: 10, scale: 8 })
  lat: number;

  @Column({ type: 'decimal', precision: 11, scale: 8 })
  lng: number;

  @Column()
  total_slots: number;

  @Column()
  available_slots: number;

  @Column()
  status: string;

  @ManyToOne('User')
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @OneToMany('ParkingSlot', (slot: ParkingSlot) => slot.parkingLot)
  parkingSlots: ParkingSlot[];

  @OneToMany('Gate', (gate: Gate) => gate.parkingLot)
  gates: Gate[];

  @OneToMany('ParkingFloor',(floor : ParkingFloor) => floor.parkingLot)
  parkingFloor : ParkingFloor[];
}
