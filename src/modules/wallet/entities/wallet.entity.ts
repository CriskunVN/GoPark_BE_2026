import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import type { User } from '../../users/entities/user.entity';
import type { WalletTransaction } from './wallet-transaction.entity';

@Entity('wallets')
export class Wallet {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  balance: number;

  @Column({ default: 'ACTIVE' })
  status: string;

  @CreateDateColumn()
  created_at: Date;

  @OneToOne('User', (user: User) => user.wallet, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @OneToMany(
    'WalletTransaction',
    (transaction: WalletTransaction) => transaction.wallet,
  )
  transactions: WalletTransaction[];
}
