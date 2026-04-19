import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue, Job } from 'bull';
import { NotificationJobData, NotificationJobType } from './notification.job';
import { uuidv7 } from 'uuidv7';
import { CreateNotificationDto } from '../dto/create-notification.dto';

@Injectable()
export class NotificationQueueService {
  private readonly logger = new Logger(NotificationQueueService.name);

  constructor(
    @InjectQueue('notifications')
    private notificationQueue: Queue<NotificationJobData>,
  ) {}

  async sendToUsers(
    notificationDto: any,
    userIds: string[],
  ): Promise<{ jobId: string; message: string }> {
    // Tạo jobId duy nhất cho mỗi job
    const jobId = uuidv7();
    // Chuẩn bị dữ liệu cho job
    const jobData: NotificationJobData = {
      type: NotificationJobType.SEND_TO_USERS,
      notificationDto,
      userIds,
      jobId,
      requestedAt: new Date().toISOString(),
    };

    // Thêm job vào hàng đợi với cấu hình retry và lưu trữ kết quả
    const job = await this.notificationQueue.add(jobData, {
      jobId: `send-users-${jobId}`,
      attempts: 3, // số lần retry nếu thất bại
      // Cấu hình backoff để retry sau 2s, 4s, 8s nếu thất bại
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      // Giữ job đã hoàn thành trong 1h để có thể xem lại kết quả, giữ job thất bại để debug
      removeOnComplete: {
        age: 3600, // giữ 1h
      },
      // removeOnFail: false để giữ lại các job thất bại, giúp debug sau này
      removeOnFail: false, // giữ failed jobs để debug
    });

    this.logger.log(
      `Đã thêm job vào hàng đợi: ${job.id} cho ${userIds.length} người dùng`,
    );

    return {
      jobId: String(job.id),
      message: `Đã xếp hàng gửi thông báo cho ${userIds.length} người dùng`,
    };
  }

  async sendToRole(
    notificationDto: CreateNotificationDto,
  ): Promise<{ jobId: string; message: string }> {
    const jobId = uuidv7();
    const jobData: NotificationJobData = {
      type: NotificationJobType.SEND_TO_ROLE,
      notificationDto,
      targetRole: notificationDto.target_role,
      jobId,
      requestedAt: new Date().toISOString(),
    };

    const job = await this.notificationQueue.add(jobData, {
      jobId: `send-role-${jobId}`,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: {
        age: 3600,
      },
      removeOnFail: false,
    });

    this.logger.log(
      `Đã thêm job vào hàng đợi: ${job.id} cho vai trò ${notificationDto.target_role}`,
    );

    return {
      jobId: String(job.id),
      message: `Đã xếp hàng gửi thông báo cho vai trò: ${notificationDto.target_role}`,
    };
  }

  async broadcast(
    notificationDto: any,
  ): Promise<{ jobId: string; message: string }> {
    const jobId = uuidv7();
    const batchSize = 100; // chia 100 users/batch

    const jobData: NotificationJobData = {
      type: NotificationJobType.BROADCAST,
      notificationDto,
      jobId,
      requestedAt: new Date().toISOString(),
      batchSize,
    };

    const job = await this.notificationQueue.add(jobData, {
      jobId: `broadcast-${jobId}`,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: {
        age: 3600,
      },
      removeOnFail: false,
    });

    this.logger.log(`Đã thêm job broadcast vào hàng đợi: ${job.id}`);

    return {
      jobId: String(job.id),
      message: 'Đã xếp hàng gửi thông báo broadcast',
    };
  }

  // Lấy trạng thái job theo jobId
  async getJobStatus(jobId: string): Promise<Job<NotificationJobData>> {
    const job = await this.notificationQueue.getJob(jobId);
    if (!job) {
      throw new NotFoundException(`Không tìm thấy job ${jobId}`);
    }
    return job;
  }

  // Lấy thời gian xử lý và tiến trình của 1 job
  async getJobTiming(jobId: string) {
    const job = await this.notificationQueue.getJob(jobId);
    if (!job) {
      throw new NotFoundException(`Không tìm thấy job ${jobId}`);
    }

    const state = await job.getState();
    const progress = job.progress();

    const createdAt = job.timestamp
      ? new Date(job.timestamp).toISOString()
      : null;
    const processedAt = job.processedOn
      ? new Date(job.processedOn).toISOString()
      : null;
    const finishedAt = job.finishedOn
      ? new Date(job.finishedOn).toISOString()
      : null;

    const durationMs =
      job.processedOn && job.finishedOn
        ? job.finishedOn - job.processedOn
        : null;

    return {
      jobId: String(job.id),
      state,
      progress,
      attemptsMade: job.attemptsMade,
      createdAt,
      processedAt,
      finishedAt,
      durationMs,
      durationSeconds:
        durationMs !== null ? Number((durationMs / 1000).toFixed(2)) : null,
      failedReason: job.failedReason || null,
      result: job.returnvalue ?? null,
    };
  }

  // Lấy thống kê số lượng job ở các trạng thái khác nhau
  async getQueueStats() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.notificationQueue.getWaitingCount(),
      this.notificationQueue.getActiveCount(),
      this.notificationQueue.getCompletedCount(),
      this.notificationQueue.getFailedCount(),
      this.notificationQueue.getDelayedCount(),
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
    };
  }
}
