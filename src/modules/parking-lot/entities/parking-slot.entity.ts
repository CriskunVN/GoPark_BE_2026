import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type { ParkingLot } from './parking-lot.entity';
import { ParkingZone } from './parking-zone.entity';

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

  @ManyToOne('ParkingZone', (zone: ParkingZone) => zone.slot)
  @JoinColumn({ name: 'parking_zone_id' })
  parkingZone: ParkingZone;
}
