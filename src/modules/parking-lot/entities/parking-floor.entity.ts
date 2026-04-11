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
import { ParkingSlot } from './parking-slot.entity';
import { PricingRule } from 'src/modules/payment/entities/pricingrule.entity';

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

  @OneToMany(() => ParkingZone, (zone: ParkingZone) => zone.parkingFloor)
  parkingZones: ParkingZone[];

  @ManyToOne(() => ParkingLot, (lot: ParkingLot) => lot.parkingFloor, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'parking_lot_id' })
  parkingLot: ParkingLot;

  @OneToMany(() => ParkingSlot, (slot: ParkingSlot) => slot.parkingFloor)
  parkingSlot: ParkingSlot[];

  @OneToMany(() => PricingRule, (rule: PricingRule) => rule.parkingFloor)
  pricingRule: PricingRule[];
}
