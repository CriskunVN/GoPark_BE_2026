import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';
import { NotificationRecipient } from './entities/notification_recipient.entity';
import { Notification } from './entities/notification.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResNotificationDto } from './dto/res-notification.dto';
import { User } from '../users/entities/user.entity';
import { NotificationQueueService } from './jobs/notification-queue.service';
import {
  GetNotificationTableDto,
  NotificationTableItemDto,
  NotificationTableResponseDto,
} from './dto/notification-table.dto';

@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(NotificationRecipient)
    private notificationRecipientRepository: Repository<NotificationRecipient>,

    @InjectRepository(Notification)
    private notificationRepository: Repository<Notification>,

    @InjectRepository(User)
    private userRepository: Repository<User>,

    private notificationQueueService: NotificationQueueService,
  ) {}

  async create(createNotificationDto: CreateNotificationDto) {
    // Logic để tạo thông báo mới
    const notification = this.notificationRepository.create({
      title: createNotificationDto.title,
      content: createNotificationDto.content,
      target_role: createNotificationDto.target_role,
      type: createNotificationDto.type,
    });
    await this.notificationRepository.save(notification);

    // tạo thông báo cho tất cả người dùng thuộc vai trò mục tiêu
    // Logic để tạo thông báo cho tất cả người dùng thuộc vai trò mục tiêu

    return notification;
  }

  findAll() {
    return this.notificationRepository.find();
  }

  findOne(id: number) {
    return `This action returns a #${id} notification`;
  }

  update(id: number, updateNotificationDto: UpdateNotificationDto) {
    return `This action updates a #${id} notification`;
  }

  remove(id: number) {
    return `This action removes a #${id} notification`;
  }

  async getAllNotificationForUser(userId: string) {
    const notifications = await this.notificationRecipientRepository.find({
      where: { recipient: { id: userId } },
      relations: ['notification'],
      order: { createdAt: 'DESC' },
    });

    return notifications.map((item) =>
      ResNotificationDto.mapFromEntity(item.notification),
    );
  }

  async getUnreadNotificationForUser(userId: string) {
    const notifications = await this.notificationRecipientRepository.find({
      where: { recipient: { id: userId }, is_read: false },
      relations: ['notification'],
      order: { createdAt: 'DESC' },
    });

    return notifications.map((item) =>
      ResNotificationDto.mapFromEntity(item.notification),
    );
  }

  async markAsRead(notificationId: string, userId: string) {
    const notificationRecipient =
      await this.notificationRecipientRepository.findOne({
        where: {
          notification: { id: notificationId },
          recipient: { id: userId },
        },
      });

    if (!notificationRecipient) {
      throw new Error('Không tìm thấy thông báo cho người dùng này');
    }

    notificationRecipient.is_read = true;
    notificationRecipient.read_at = new Date();

    await this.notificationRecipientRepository.save(notificationRecipient);

    return {
      message: 'Đánh dấu thông báo đã đọc thành công',
    };
  }

  async markAllAsRead(userId: string) {
    await this.notificationRecipientRepository
      .createQueryBuilder()
      .update(NotificationRecipient)
      .set({
        is_read: true,
        read_at: new Date(),
      })
      .where('user_id = :userId', { userId })
      .andWhere('is_read = :isRead', { isRead: false })
      .execute();

    return {
      message: 'Đánh dấu tất cả thông báo đã đọc thành công',
    };
  }

  async countUnreadNotificationForUser(userId: string) {
    const count = await this.notificationRecipientRepository.count({
      where: { recipient: { id: userId }, is_read: false },
    });

    return count;
  }

  // ----------- Gửi thông báo đến một hoặc một vài người dùng ----------
  async sendNotificationToUsers(
    notificationDto: CreateNotificationDto,
    userIds: string[],
  ) {
    return this.notificationQueueService.sendToUsers(notificationDto, userIds);
  }

  // ---------- Gửi thông báo đến tất cả người dùng ----------
  async broadcastNotification(notificationDto: CreateNotificationDto) {
    return this.notificationQueueService.broadcast(notificationDto);
  }

  // ---------- Gửi thông báo theo vai trò (admin, owner, user) ----------
  async sendNotificationToRole(notificationDto: CreateNotificationDto) {
    return this.notificationQueueService.sendToRole(notificationDto);
  }

  /**
   * Lấy danh sách thông báo cho bảng admin
   * Không lọc theo userId, vì admin cần xem toàn bộ thông báo đã tạo.
   */
  async getAdminNotificationTable(
    query: GetNotificationTableDto,
  ): Promise<NotificationTableResponseDto> {
    const {
      page = 1,
      limit = 10,
      search,
      type,
      sortBy = 'createdAt',
      sortOrder = 'DESC',
    } = query;

    const skip = (page - 1) * limit;

    let queryBuilder = this.notificationRepository.createQueryBuilder('n');

    if (type) {
      queryBuilder = queryBuilder.andWhere('n.type = :type', { type });
    }

    if (search) {
      queryBuilder = queryBuilder.andWhere(
        '(n.title ILIKE :search OR n.content ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    const sortColumn = sortBy === 'readAt' ? 'n.createdAt' : 'n.createdAt';

    queryBuilder = queryBuilder.orderBy(sortColumn, sortOrder);

    const total = await queryBuilder.getCount();

    const notifications = await queryBuilder.skip(skip).take(limit).getMany();

    const notificationIds = notifications.map((item) => item.id);

    const stats =
      notificationIds.length > 0
        ? await this.notificationRecipientRepository
            .createQueryBuilder('nr')
            .select('nr.notification_id', 'notificationId')
            .addSelect('COUNT(nr.id)', 'recipientCount')
            .addSelect(
              'COUNT(CASE WHEN nr.is_read = true THEN 1 END)',
              'readCount',
            )
            .where('nr.notification_id IN (:...notificationIds)', {
              notificationIds,
            })
            .groupBy('nr.notification_id')
            .getRawMany()
        : [];

    const statMap = new Map(
      stats.map((item) => [
        item.notificationId,
        {
          recipientCount: Number(item.recipientCount) || 0,
          readCount: Number(item.readCount) || 0,
        },
      ]),
    );

    const items: NotificationTableItemDto[] = notifications.map((n) => {
      const stat = statMap.get(n.id) ?? { recipientCount: 0, readCount: 0 };

      return {
        id: n.id,
        title: n.title,
        type: n.type,
        targetRole: n.target_role,
        isRead:
          stat.recipientCount > 0 && stat.readCount === stat.recipientCount,
        readSummary: `${stat.readCount}/${stat.recipientCount}`,
        recipientCount: stat.recipientCount,
        readCount: stat.readCount,
        status: stat.recipientCount > 0 ? 'Đã gửi' : 'Chưa có người nhận',
        createdAt: n.createdAt,
        readAt: null,
      };
    });

    const totalPages = Math.ceil(total / limit);

    return {
      items,
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }
}
