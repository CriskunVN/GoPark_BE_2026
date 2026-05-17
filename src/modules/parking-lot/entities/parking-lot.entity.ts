import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import type { User } from '../../users/entities/user.entity';
import { ParkingFloor } from './parking-floor.entity';
import { ParkingLotStatus } from 'src/common/enums/status.enum';
import { Review } from 'src/modules/users/entities/review.entity';

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
  @Index()
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

  @Column({ nullable: true })
  description?: string;

  @Column({ type: 'time', nullable: true })
  open_time: string;

  @Column({ type: 'time', nullable: true })
  close_time: string;

  @Column({ nullable: true })
  operating_days: string;

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

  @OneToMany('ParkingFloor', (floor: ParkingFloor) => floor.parkingLot)
  parkingFloor: ParkingFloor[];

  @OneToMany('Review', (review: Review) => review.lot)
  review: Review[];
}
