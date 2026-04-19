import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Process, Processor } from '@nestjs/bull';
import {
  NotificationJobData,
  NotificationJobType,
  NotificationJobResult,
} from './notification.job';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from '../entities/notification.entity';
import { NotificationRecipient } from '../entities/notification_recipient.entity';
import { User } from '../../users/entities/user.entity';
import type { Job } from 'bull';

@Processor('notifications')
@Injectable()
export class NotificationWorker {
  private readonly logger = new Logger(NotificationWorker.name);

  constructor(
    @InjectRepository(Notification)
    private notificationRepository: Repository<Notification>,

    @InjectRepository(NotificationRecipient)
    private notificationRecipientRepository: Repository<NotificationRecipient>,

    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  @Process()
  async handleNotificationJob(
    job: Job<NotificationJobData>,
  ): Promise<NotificationJobResult> {
    const jobType = job.data.type;
    const startedAt = Date.now();
    this.logger.log(`Đang xử lý job ${job.id} với loại ${jobType}`);

    try {
      let result: NotificationJobResult;

      switch (jobType) {
        case NotificationJobType.SEND_TO_USERS:
          result = await this.processSendToUsers(job);
          break;

        case NotificationJobType.SEND_TO_ROLE:
          result = await this.processSendToRole(job);
          break;

        case NotificationJobType.BROADCAST:
          result = await this.processBroadcast(job);
          break;

        default:
          throw new Error(`Loại job không hợp lệ: ${jobType}`);
      }

      this.logger.log(
        `Hoàn tất job ${job.id} (${jobType}) trong ${Date.now() - startedAt}ms`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Job ${job.id} thất bại: ${error.message}`,
        error.stack,
      );
      throw error; // bull sẽ retry dựa trên attempts
    }
  }

  private async processSendToUsers(
    job: Job<NotificationJobData>,
  ): Promise<NotificationJobResult> {
    const data = job.data as any;

    // 1. Tạo notification hoặc lấy existing
    let notification;
    if (data.notificationDto.id) {
      notification = await this.notificationRepository.findOne({
        where: { id: data.notificationDto.id },
      });
    }

    if (!notification) {
      notification = this.notificationRepository.create({
        title: data.notificationDto.title,
        content: data.notificationDto.content,
        target_role: data.notificationDto.target_role,
        type: data.notificationDto.type,
      });
      await this.notificationRepository.save(notification);
    }

    // Lọc ra các user thực sự tồn tại trong hệ thống để tránh lỗi Foreign Key
    const validUsers = await this.userRepository
      .createQueryBuilder('user')
      .where('user.id IN (:...userIds)', { userIds: data.userIds })
      .select(['user.id'])
      .getMany();

    const validUserIds = validUsers.map((u) => u.id);

    // 2. Tạo recipients theo batch để tránh memory spike
    const batchSize = 100;
    let createdCount = 0;

    for (let i = 0; i < validUserIds.length; i += batchSize) {
      const batch = validUserIds.slice(i, i + batchSize);
      const recipients = batch.map((userId) =>
        this.notificationRecipientRepository.create({
          notification,
          recipient: { id: userId } as any,
        }),
      );

      await this.notificationRecipientRepository.save(recipients);
      createdCount += recipients.length;

      // Report progress
      await job.progress((createdCount / validUserIds.length) * 100);
    }

    return {
      success: true,
      jobId: data.jobId,
      type: NotificationJobType.SEND_TO_USERS,
      message: `Đã gửi cho ${createdCount} người dùng`,
      recipientCount: createdCount,
      processedAt: new Date().toISOString(),
    };
  }

  private async processSendToRole(
    job: Job<NotificationJobData>,
  ): Promise<NotificationJobResult> {
    const data = job.data as any;

    // 1. Tạo notification hoặc lấy existing
    let notification;
    if (data.notificationDto.id) {
      notification = await this.notificationRepository.findOne({
        where: { id: data.notificationDto.id },
      });
    }

    if (!notification) {
      notification = this.notificationRepository.create({
        title: data.notificationDto.title,
        content: data.notificationDto.content,
        target_role: data.notificationDto.target_role,
        type: data.notificationDto.type,
      });
      await this.notificationRepository.save(notification);
    }

    // 2. Lấy danh sách user theo role
    const normalizedRole = data.targetRole.toUpperCase();
    const users = await this.userRepository
      .createQueryBuilder('user')
      .innerJoin('user.userRoles', 'userRole')
      .innerJoin('userRole.role', 'role')
      .where('UPPER(role.name) = :targetRole', { targetRole: normalizedRole })
      .select(['user.id'])
      .getMany();

    // 3. Tạo recipients theo batch
    const batchSize = 100;
    let createdCount = 0;

    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);
      const recipients = batch.map((user) =>
        this.notificationRecipientRepository.create({
          notification,
          recipient: { id: user.id } as any,
        }),
      );

      await this.notificationRecipientRepository.save(recipients);
      createdCount += recipients.length;

      await job.progress((createdCount / users.length) * 100);
    }

    return {
      success: true,
      jobId: data.jobId,
      type: NotificationJobType.SEND_TO_ROLE,
      message: `Đã gửi cho ${createdCount} người dùng có vai trò ${data.targetRole}`,
      recipientCount: createdCount,
      processedAt: new Date().toISOString(),
    };
  }

  private async processBroadcast(
    job: Job<NotificationJobData>,
  ): Promise<NotificationJobResult> {
    const data = job.data as any;
    const batchSize = data.batchSize || 500;

    // 1. Tạo notification hoặc lấy existing
    let notification;
    if (data.notificationDto.id) {
      notification = await this.notificationRepository.findOne({
        where: { id: data.notificationDto.id },
      });
    }

    if (!notification) {
      notification = this.notificationRepository.create({
        title: data.notificationDto.title,
        content: data.notificationDto.content,
        target_role: data.notificationDto.target_role,
        type: data.notificationDto.type,
      });
      await this.notificationRepository.save(notification);
    }

    // 2. Lấy tất cả user (với pagination)
    const totalUsers = await this.userRepository.count();
    let createdCount = 0;
    const pageSize = batchSize;

    for (let page = 0; page < Math.ceil(totalUsers / pageSize); page++) {
      const users = await this.userRepository
        .createQueryBuilder('user')
        .select(['user.id'])
        .skip(page * pageSize)
        .take(pageSize)
        .getMany();

      const recipients = users.map((user) =>
        this.notificationRecipientRepository.create({
          notification,
          recipient: { id: user.id } as any,
        }),
      );

      await this.notificationRecipientRepository.save(recipients);
      createdCount += recipients.length;

      await job.progress((createdCount / totalUsers) * 100);
    }

    return {
      success: true,
      jobId: data.jobId,
      type: NotificationJobType.BROADCAST,
      message: `Đã broadcast cho ${createdCount} người dùng`,
      recipientCount: createdCount,
      processedAt: new Date().toISOString(),
    };
  }
}
