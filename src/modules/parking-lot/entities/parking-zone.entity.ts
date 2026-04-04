import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ParkingFloor } from './parking-floor.entity';
import { ParkingSlot } from './parking-slot.entity';
import { PricingRule } from 'src/modules/payment/entities/pricingrule.entity';

@Entity('parking_zones')
export class ParkingZone {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  zone_name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'timestamp' })
  created_at: Date;

  @ManyToOne('ParkingFloor', (floor: ParkingFloor) => floor.parkingZone)
  @JoinColumn({ name: 'parking_floor_id' })
  parkingFloor: ParkingFloor;

  @OneToMany(
    'ParkingSlot',
    (parkingSlot: ParkingSlot) => parkingSlot.parkingZone,
  )
  slot: ParkingSlot[];

  @OneToMany('PricingRule', (pricingRule : PricingRule) => pricingRule.parkingZone)
  pricingRule: PricingRule[];
}
