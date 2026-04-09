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

  @ManyToOne('ParkingZone', (zone: ParkingZone) => zone.pricingRule, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'parking_zone_id' })
  parkingZone: ParkingZone;
}
