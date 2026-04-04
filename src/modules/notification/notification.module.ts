import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { Notification } from './entities/notification.entity';
import { NotificationRecipient } from './entities/notification_recipient.entity';
import { AdminNotificationController } from './admin-notification.controller';
import { User } from '../users/entities/user.entity';
import { NotificationQueueService } from './jobs/notification-queue.service';
import { NotificationWorker } from './jobs/notification.worker';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, NotificationRecipient, User]),
    BullModule.registerQueue({
      name: 'notifications',
      defaultJobOptions: {
        removeOnComplete: {
          age: 3600,
        },
      },
    }),
  ],
  controllers: [NotificationController, AdminNotificationController],
  providers: [
    NotificationService,
    NotificationQueueService,
    NotificationWorker,
  ],
  exports: [
    TypeOrmModule,
    NotificationService,
    NotificationQueueService,
    BullModule,
  ],
})
export class NotificationModule {}
