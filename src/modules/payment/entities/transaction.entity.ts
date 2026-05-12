import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import type { Payment } from './payment.entity';
import { TransactionStatus } from 'src/common/enums/status.enum';
import type { Booking } from '../../booking/entities/booking.entity';
import type { User } from '../../users/entities/user.entity';

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ comment: 'Mã đơn hàng gửi sang VNPay (vnp_TxnRef)' })
  gateway_txn_id: string;

  @Column({ nullable: true, comment: 'Mã giao dịch của hệ thống VNPay (vnp_TransactionNo)' })
  vnpay_transaction_no: string;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount: number;

  @Column({ nullable: true })
  bank_code: string;

  @Column({ nullable: true })
  card_type: string;

  @Column({ nullable: true })
  order_info: string;

  @Column({ nullable: true, comment: 'Mã phản hồi từ VNPay (vnp_ResponseCode)' })
  response_code: string;

  @Column({ nullable: true, comment: 'Thời gian thanh toán từ VNPay (vnp_PayDate)' })
  pay_date: string;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
  })
  status: TransactionStatus;

  @Column({ type: 'jsonb', nullable: true, comment: 'Dữ liệu thô từ gateway phản hồi' })
  metadata: any;

  @CreateDateColumn()
  time: Date;

  @ManyToOne('Payment', (payment: Payment) => payment.transactions)
  @JoinColumn({ name: 'payment_id' })
  payment: Payment;

  @ManyToOne('Booking', (booking: Booking) => booking.transactions, { nullable: true })
  @JoinColumn({ name: 'booking_id' })
  booking: Booking;

  @ManyToOne('User', (user: User) => user.transactions, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
