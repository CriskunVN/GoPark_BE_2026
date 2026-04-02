import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type { ParkingSlot } from './parking-slot.entity';
import type { User } from '../../users/entities/user.entity';
import { ParkingFloor } from './parking-floor.entity';
import { ParkingLotStatus } from 'src/common/enums/status.enum';
import { Max, Min } from 'class-validator';
import { PricingRule } from 'src/modules/payment/entities/pricingrule.entity';
import { Booking } from 'src/modules/booking/entities/booking.entity';

type ParkingLotImages = {
  thumbnail?: string; // ảnh đại diện
  gallery?: string[]; // ảnh mô tả
  documents?: Array<{
    type: 'business_license' | 'parking_layout' | 'other';
    url: string;
  }>;
};

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

  @Column({nullable: true})
  description?: string;

  @Column({type: 'timestamp', nullable: true})
  activity_time?: Date;

  @Column({
    type: 'decimal',
    precision: 2,
    scale: 1,
    default: 0,
  })
  @Max(5, { message: 'Vote must be between 0 and 5' })
  @Min(0, { message: 'Vote must be between 0 and 5' })
  vote: number;

  @Column({
    type: 'jsonb',
    nullable: true,
    default: () => "'{}'::jsonb",
  })
  image: ParkingLotImages;

  @Column({
    type: 'enum',
    enum: ParkingLotStatus,
    default: ParkingLotStatus.INACTIVE,
  })
  status: string;

  @ManyToOne('User', (user: User) => user.id, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  owner: User;

  @OneToMany('ParkingSlot', (slot: ParkingSlot) => slot.parkingLot)
  parkingSlots: ParkingSlot[];

  @OneToMany('ParkingFloor', (floor: ParkingFloor) => floor.parkingLot)
  parkingFloor: ParkingFloor[];

  @OneToMany ('PricingRule',(pricingRule : PricingRule) => pricingRule.parkingLot)
  pricingRule: PricingRule[];

  @OneToMany('Booking',(booking : Booking) => booking.parkingLot)
  booking: Booking[];
}
