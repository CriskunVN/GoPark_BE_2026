import { ParkingFloor } from 'src/modules/parking-lot/entities/parking-floor.entity';
import { ParkingLot } from 'src/modules/parking-lot-lot/entities/parking-lot.entity';
import { ParkingZone } from 'src/modules/parking-lot/entities/parking-zone.entity';
import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('pricing_rules')
export class PricingRule {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  price_per_hour: number;

  @Column()
  price_per_day: number;

  @ManyToOne('ParkingLot', (lot: ParkingLot) => lot.pricingRule, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'parking_lot_id' })
  parkingLot: ParkingLot;

  @ManyToOne('ParkingFloor', (floor: ParkingFloor) => floor.pricingRule, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'parking_floor_id' })
  parkingFloor: ParkingFloor;

  @ManyToOne('ParkingZone', (zone: ParkingZone) => zone.pricingRule, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'parking_zone_id' })
  parkingZone: ParkingZone;
}
