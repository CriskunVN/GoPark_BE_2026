import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import type { Payment } from './payment.entity';

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  gateway_txn_id: string;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount: number;

  @Column()
  status: string;

  @CreateDateColumn()
  time: Date;

  @ManyToOne('Payment', (payment: Payment) => payment.transactions)
  @JoinColumn({ name: 'payment_id' })
  payment: Payment;
}
