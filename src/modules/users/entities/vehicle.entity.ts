import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type { User } from './user.entity';

@Entity('vehicles')
export class Vehicle {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  plate_number: string;

  @Column()
  type: string;

  @ManyToOne('User', (user: User) => user.vehicles)
  @JoinColumn({ name: 'user_id' })
  user: User;
}
