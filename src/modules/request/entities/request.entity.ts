import { BaseEntity } from 'src/common/entity/base.entity';
import { RequestStatus } from 'src/common/enums/status.enum';
import { User } from 'src/modules/users/entities/user.entity';
import { Column, Entity, ManyToOne } from 'typeorm';

export enum RequestType {
  UPDATE_PARKING_LOT = 'UPDATE_PARKING_LOT',
  PAYMENT = 'PAYMENT',
  BECOME_OWNER = 'BECOME_OWNER',
  WITHDRAW_FUND = 'WITHDRAW_FUND',
  REFUND = 'REFUND',
  NEW_PARKING_LOT = 'NEW_PARKING_LOT',
}

@Entity('system_requests')
export class Request extends BaseEntity {
  @Column({
    type: 'enum',
    enum: RequestType,
  })
  type: string; // e.g., 'PARKING_SLOT', 'PAYMENT'

  @Column({
    type: 'enum',
    enum: RequestStatus,
    default: RequestStatus.PENDING,
  })
  status: string; // e.g., 'PENDING', 'APPROVED', 'REJECTED'

  // lưu thông tin yêu cầu dưới dạng JSON, có thể là chi tiết về parking lot, thông tin thanh toán, v.v.
  @Column({ type: 'jsonb' })
  payload: Record<string, any>;

  @Column({ type: 'text', nullable: true })
  description: string; // mô tả thêm về yêu cầu, có thể do người dùng nhập hoặc hệ thống tự sinh ra

  // Lưu lý do từ chối hoặc ghi chú của Admin
  @Column({ type: 'text', nullable: true })
  note: string;

  @ManyToOne('User', (user: User) => user.requests, { onDelete: 'CASCADE' })
  requester: User;
}
