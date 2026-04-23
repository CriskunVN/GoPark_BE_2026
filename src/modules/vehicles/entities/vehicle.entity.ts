import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type { User } from '../../users/entities/user.entity';

@Entity('vehicles')
export class Vehicle {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  plate_number: string;

  @Column({ nullable: true })
  owner_name: string;

  @Column({ nullable: true })
  brand: string;

  @Column({ nullable: true })
  type: string;

  @Column({ type: 'text', nullable: true })
  image: string;

  @ManyToOne('User', (user: User) => user.vehicles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
