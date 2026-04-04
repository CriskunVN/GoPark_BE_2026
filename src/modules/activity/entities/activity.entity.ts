import { BaseEntity } from 'src/common/entity/base.entity';
import { ActivityStatus } from 'src/common/enums/status.enum';
import { ActivityType } from 'src/common/enums/type.enum';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('activities')
export class Activity extends BaseEntity {
  @Column({ type: 'enum', enum: ActivityType })
  type: ActivityType;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'enum', enum: ActivityStatus })
  status: ActivityStatus;

  @Column({ type: 'uuid', nullable: true })
  user_id?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  user_name?: string; // Lưu tên hiển thị lúc tạo log

  @Column({ type: 'jsonb', nullable: true })
  meta?: Record<string, any>; // Lưu thêm thông tin chi tiết dưới dạng JSON
}
