import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type { ParkingLot } from './parking-lot.entity';

@Entity('gates')
export class Gate {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  type: string; // IN, OUT

  @ManyToOne('ParkingLot', (parkingLot: ParkingLot) => parkingLot.gates, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'parking_lot_id' })
  parkingLot: ParkingLot;
}
