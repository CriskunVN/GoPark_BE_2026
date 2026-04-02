import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type { ParkingLot } from './parking-lot.entity';
import { ParkingZone } from './parking-zone.entity';
import { ParkingFloor } from './parking-floor.entity';

@Entity('parking_slots')
export class ParkingSlot {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  code: string;

  @Column()
  status: string; // available, occupied, reserved

  @ManyToOne(
    'ParkingLot',
    (parkingLot: ParkingLot) => parkingLot.parkingSlots,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'parking_lot_id' })
  parkingLot: ParkingLot;

  @ManyToOne('ParkingFloor', (floor: ParkingFloor) => floor.parkingSlot, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'parking_floor_id' })
  parkingFloor: ParkingFloor;

  @ManyToOne('ParkingZone', (zone: ParkingZone) => zone.slot, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'parking_zone_id' })
  parkingZone: ParkingZone;
}
