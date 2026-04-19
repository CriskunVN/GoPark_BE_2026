import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Activity } from './entities/activity.entity';
import { ActivityType } from 'src/common/enums/type.enum';
import { ActivityStatus } from 'src/common/enums/status.enum';
import { UsersService } from '../users/users.service';

type LogActivityInput = {
  type: ActivityType;
  content: string;
  status?: ActivityStatus;
  userId?: string;
  userName?: string;
  meta?: Record<string, any>;
};

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(
    @InjectRepository(Activity)
    private readonly activityRepository: Repository<Activity>,
    private readonly UserService: UsersService,
  ) {}

  async logActivity(input: LogActivityInput) {
    // lấy name của user nếu có userId nhưng chưa có userName
    if (input.userId && !input.userName) {
      const userName = await this.UserService.getNameByUserId(input.userId);
      input.userName = userName;
    }
    try {
      const activity = this.activityRepository.create({
        type: input.type,
        content: input.content,
        status: input.status,
        user_id: input.userId,
        user_name: input.userName,
        meta: input.meta,
      });

      await this.activityRepository.save(activity);
    } catch (error) {
      this.logger.error('Không thể lưu activity', error as any);
    }
  }

  async getRecentActivities(limit = 5) {
    const rows = await this.activityRepository.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });

    return rows.map((item) => ({
      id: item.id,
      type: item.type,
      content: item.content,
      username: item.user_name,
      time: this.toRelativeTime(item.createdAt),
      status: item.status,
    }));
  }

  private toRelativeTime(date: Date): string {
    const value = new Date(date).getTime();
    const diffInMs = Date.now() - value;

    if (diffInMs < 60 * 1000) return 'Vừa xong';

    const diffInMinutes = Math.floor(diffInMs / (60 * 1000));
    if (diffInMinutes < 60) return `${diffInMinutes} phút trước`;

    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours} giờ trước`;

    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 30) return `${diffInDays} ngày trước`;

    const diffInMonths = Math.floor(diffInDays / 30);
    if (diffInMonths < 12) return `${diffInMonths} tháng trước`;

    const diffInYears = Math.floor(diffInMonths / 12);
    return `${diffInYears} năm trước`;
  }

  async getActivitiesForUser(userId: string) {
    const activities = await this.activityRepository.find({
      where: { user_id: userId },
      order: { createdAt: 'DESC' },
    });

    return activities.map((item) => ({
      id: item.id,
      type: item.type,
      content: item.content,
      time: this.toRelativeTime(item.createdAt),
      status: item.status,
    }));
  }

  async getActivitiesForUserByType(userId: string, type: ActivityType) {
    const activities = await this.activityRepository.find({
      where: { user_id: userId, type },
      order: { createdAt: 'DESC' },
    });

    return activities.map((item) => ({
      id: item.id,
      type: item.type,
      content: item.content,
      time: this.toRelativeTime(item.createdAt),
      status: item.status,
    }));
  }

  async getActivitiesByType(type: ActivityType) {
    const activities = await this.activityRepository.find({
      where: { type },
      order: { createdAt: 'DESC' },
    });

    return activities.map((item) => ({
      id: item.id,
      type: item.type,
      content: item.content,
      time: this.toRelativeTime(item.createdAt),
      status: item.status,
    }));
  }

  async getAllActivities() {
    const activities = await this.activityRepository.find({
      order: { createdAt: 'DESC' },
    });

    return activities.map((item) => ({
      id: item.id,
      type: item.type,
      content: item.content,
      time: this.toRelativeTime(item.createdAt),
      userName: item.user_name,
      status: item.status,
      meta: item.meta,
    }));
  }
}
