import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { NotificationService } from './notification.service';
import { NotificationQueueService } from './jobs/notification-queue.service';
import {
  BroadcastNotificationDto,
  SendNotificationToRolesDto,
  SendNotificationToUsersDto,
} from './dto/send-notification.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRoleEnum } from 'src/common/enums/role.enum';
import { GetNotificationTableDto } from './dto/notification-table.dto';

@Controller('admin/notifications')
export class AdminNotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly notificationQueueService: NotificationQueueService,
  ) {}

  // ----------- Tạo thông báo mới
  @Post()
  createNotification(@Body() createNotificationDto: CreateNotificationDto) {
    // Logic để tạo thông báo mới
    const data = this.notificationService.create(createNotificationDto);

    return {
      message: 'Tạo thông báo thành công',
      data,
    };
  }

  // ----------- Lấy tất cả thông báo ----------
  @Get()
  findAll() {
    return this.notificationService.findAll();
  }

  // ----------- Gửi thông báo đến một hoặc một vài người dùng ----------
  @Post('send-to-user')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoleEnum.ADMIN)
  async sendToUser(@Body() body: SendNotificationToUsersDto) {
    const { notification, userIds } = body;
    const result = await this.notificationQueueService.sendToUsers(
      notification,
      userIds,
    );
    return {
      message: result.message,
      jobId: result.jobId,
    };
  }

  // ----------- Gửi thông báo đến tất cả người dùng ----------
  @Post('broadcast')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoleEnum.ADMIN)
  async broadcastNotification(@Body() body: BroadcastNotificationDto) {
    const { notification } = body;
    const result = await this.notificationQueueService.broadcast(notification);
    return {
      message: result.message,
      jobId: result.jobId,
    };
  }

  // ----------- Gửi thông báo theo vai trò (admin, owner, user) ----------
  @Post('send-to-role')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoleEnum.ADMIN)
  async sendToRole(@Body() body: SendNotificationToRolesDto) {
    const { notification } = body;
    const result = await this.notificationQueueService.sendToRole(notification);
    return {
      message: result.message,
      jobId: result.jobId,
    };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoleEnum.ADMIN)
  @Get('table/list')
  async getNotificationTable(
    @Req() req: any,
    @Query() query: GetNotificationTableDto,
  ) {
    const data =
      await this.notificationService.getAdminNotificationTable(query);

    return {
      message: 'Lấy danh sách thông báo cho bảng thành công',
      data,
    };
  }
}
