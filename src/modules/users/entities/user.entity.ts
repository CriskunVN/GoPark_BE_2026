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
import { BaseEntity } from 'src/common/entity/base.entity';
import { UserStatus } from 'src/common/enums/userStatus.enum';

@Entity('users')
export class User extends BaseEntity {
  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column({
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.SPENDING,
  })
  status: string;

  @Column({ type: 'text', nullable: true })
  refreshToken: string | null;

  @Column({ type: 'text', nullable: true })
  verifyToken: string | null;

  @Column({ type: 'text', nullable: true })
  resetPasswordToken: string | null;

  @OneToOne('Profile', (profile: Profile) => profile.user, { cascade: true })
  profile: Profile;

  @OneToMany('UserRole', (userRole: UserRole) => userRole.user, {
    cascade: true,
  })
  userRoles: UserRole[];

  @OneToOne('Wallet', (wallet: Wallet) => wallet.user, { cascade: true })
  wallet: Wallet;

  @OneToMany('Vehicle', (vehicle: Vehicle) => vehicle.user, { cascade: true })
  vehicles: Vehicle[];

  @OneToMany('Booking', (booking: Booking) => booking.user, { cascade: true })
  bookings: Booking[];

  @OneToMany('ParkingLot', (parkingLot: ParkingLot) => parkingLot.owner, {
    cascade: true,
  })
  ownedParkingLots: ParkingLot[];
}
