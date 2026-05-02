import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { CheckLog } from '../../booking/entities/check-log.entity';

@Entity('gates')
export class Gate {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  name: string;

  @Column({
    type: 'enum',
    enum: ['IN', 'OUT', 'BOTH'],
    default: 'BOTH',
  })
  type: 'IN' | 'OUT' | 'BOTH';

  @Column({ default: 'ACTIVE' })
  status: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  // Liên kết với bãi đỗ xe (ParkingLot)
  @ManyToOne('ParkingLot', 'gates', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parking_lot_id' })
  parkingLot: any;

  @OneToMany(() => CheckLog, (checkLog) => checkLog.gate)
  checkLogs: CheckLog[];

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;
}
