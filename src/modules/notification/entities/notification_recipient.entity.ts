import { BaseEntity } from 'src/common/entity/base.entity';
import { User } from 'src/modules/users/entities/user.entity';
import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { Notification } from './notification.entity';

@Entity('notification_recipients')
export class NotificationRecipient extends BaseEntity {
  @ManyToOne(
    'Notification',
    (notification: Notification) => notification.recipients,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'notification_id' })
  notification: Notification;

  @ManyToOne('User', (user: User) => user.notifications, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  recipient: User;

  @Column({ default: false })
  is_read: boolean;

  @Column({ type: 'timestamp', nullable: true })
  read_at: Date | null;
}
