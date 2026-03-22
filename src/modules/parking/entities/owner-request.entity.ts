import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { ParkingLot } from './parking-lot.entity';

@Entity('owner_requests')
export class OwnerRequest {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => ParkingLot)
  @JoinColumn({ name: 'parkinglot_id' })
  parkingLot: ParkingLot;

  @Column({ name: 'pricingrule_id', nullable: true })
  pricingRuleId: number;

  @Column({ name: 'tax_code', nullable: true })
  taxCode: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ 
    type: 'enum', 
    enum: ['PENDING', 'APPROVED', 'REJECTED'], 
    default: 'PENDING' 
  })
  status: string;

  @Column({ name: 'admin_note', type: 'text', nullable: true })
  adminNote: string;

  @Column({ name: 'business_license', nullable: true })
  businessLicense: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}