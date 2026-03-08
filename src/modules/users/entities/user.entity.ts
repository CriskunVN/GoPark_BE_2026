import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  OneToMany,
  CreateDateColumn,
} from 'typeorm';
import type { Profile } from './profile.entity';
import type { UserRole } from './user-role.entity';
import type { Vehicle } from './vehicle.entity';
import type { Wallet } from '../../wallet/entities/wallet.entity';
import type { Booking } from '../../booking/entities/booking.entity';
import type { ParkingLot } from '../../parking/entities/parking-lot.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column({ default: 'PENDING' })
  status: string;

  @Column({ type: 'text', nullable: true })
  refreshToken: string | null;

  @Column({ type: 'text', nullable: true })
  verifyToken: string | null;

  @CreateDateColumn()
  created_at: Date;

  @OneToOne('Profile', (profile: Profile) => profile.user)
  profile: Profile;

  @OneToMany('UserRole', (userRole: UserRole) => userRole.user)
  userRoles: UserRole[];

  @OneToOne('Wallet', (wallet: Wallet) => wallet.user)
  wallet: Wallet;

  @OneToMany('Vehicle', (vehicle: Vehicle) => vehicle.user)
  vehicles: Vehicle[];

  @OneToMany('Booking', (booking: Booking) => booking.user)
  bookings: Booking[];

  @OneToMany('ParkingLot', (parkingLot: ParkingLot) => parkingLot.owner)
  ownedParkingLots: ParkingLot[];
}
