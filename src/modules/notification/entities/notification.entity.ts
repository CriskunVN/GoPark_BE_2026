import { BaseEntity } from 'src/common/entity/base.entity';
import { TargetRole } from 'src/common/enums/role.enum';
import { NotificationType } from 'src/common/enums/type.enum';
import { Column, Entity, OneToMany } from 'typeorm';
import { NotificationRecipient } from './notification_recipient.entity';

@Entity('notifications')
export class Notification extends BaseEntity {
  @Column()
  title: string;

  @Column()
  content: string;

  @Column({
    type: 'enum',
    enum: TargetRole,
    default: TargetRole.NULL,
  })
  target_role: string;

  @Column({
    type: 'enum',
    enum: NotificationType,
    default: NotificationType.SYSTEM,
  })
  type: string;

  @OneToMany(
    'NotificationRecipient',
    (recipient: NotificationRecipient) => recipient.notification,
    { cascade: true },
  )
  recipients: NotificationRecipient[];
}
