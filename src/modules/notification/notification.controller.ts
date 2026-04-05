import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Req,
  UseGuards,
  Query,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ResNotificationDto } from './dto/res-notification.dto';
import { GetNotificationTableDto } from './dto/notification-table.dto';

@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post()
  create(@Body() createNotificationDto: CreateNotificationDto) {
    return this.notificationService.create(createNotificationDto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.notificationService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateNotificationDto: UpdateNotificationDto,
  ) {
    return this.notificationService.update(+id, updateNotificationDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.notificationService.remove(+id);
  }

  // ---------Get tất cả thông báo cho user---------
  @UseGuards(JwtAuthGuard)
  @Get()
  async getAllNotification(@Req() req: any) {
    const data = await this.notificationService.getAllNotificationForUser(
      req.user['userId'],
    );

    return {
      message: 'Lấy danh sách thông báo thành công',
      data,
    };
  }

  // --------- Get thông báo chưa đọc---------
  @UseGuards(JwtAuthGuard)
  @Get('unread')
  async getUnreadNotification(@Req() req: any) {
    const data = await this.notificationService.getUnreadNotificationForUser(
      req.user['userId'],
    );

    return {
      message: 'Lấy danh sách thông báo chưa đọc thành công',
      data,
    };
  }

  // --------- Get số lượng thông báo chưa đọc (để hiển thị trên icon chuông)---------
  @Get('unread/count')
  async countUnreadNotification(@Req() req: any) {
    const count = await this.notificationService.countUnreadNotificationForUser(
      req.user['userId'],
    );

    return {
      message: 'Lấy số lượng thông báo chưa đọc thành công',
      data: count,
    };
  }

  // --------- Đánh dấu tất cả thông báo đã đọc ---------
  @Patch('read-all')
  async markAllAsRead(@Req() req: any) {
    const message = await this.notificationService.markAllAsRead(
      req.user['userId'],
    );

    return {
      message,
    };
  }

  // --------- Đánh dấu thông báo đã đọc---------
  @Patch(':id/read')
  async markAsRead(@Param('id') id: string, @Req() req: any) {
    const message = await this.notificationService.markAsRead(
      id,
      req.user['userId'],
    );

    return {
      message,
    };
  }
}
