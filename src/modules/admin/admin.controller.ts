import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
  Put,
} from '@nestjs/common';
import { AdminService } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  //Endpoint cho admin có thể xem tất cả người dùng
  @Get('users')
  @HttpCode(HttpStatus.OK)
  findAllUsers(@Query('page') page = '1', @Query('limit') limit = '10') {
    return this.adminService.findAllUsers(Number(page), Number(limit));
  }

  // Endpoint cho admin có thể xem tất cả chủ bãi
  @Get('users/owners')
  @HttpCode(HttpStatus.OK)
  findAllOwners(@Query('page') page = '1', @Query('limit') limit = '10') {
    return this.adminService.findAllOwners(Number(page), Number(limit));
  }

  // Endpoint cho admin có thể khóa / mở khóa tài khoản người dùng
  // thêm tham số status vào body để xác định trạng thái mới của người dùng (BLOCKED hoặc ACTIVE)
  @Patch('users/:id/status')
  updateStatusUser(@Param('id') id: string, @Body('status') status: string) {
    return this.adminService.blockUser(id, status);
  }

  // Endpoint cho admin có thể xem tất cả yêu cầu đang chờ xử lý
  @Get('requests')
  @HttpCode(HttpStatus.OK)
  findAllRequests(
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('status') status?: string,
  ) {
    return this.adminService.findAllRequests(
      Number(page),
      Number(limit),
      status,
    );
  }

  // Admin duyệt yêu cầu
  @Patch('requests/:id/approve')
  async approveRequest(@Param('id') id: string) {
    const result = await this.adminService.approveRequest(id, 'APPROVED');
    return {
      message: 'Yêu cầu đã được phê duyệt',
      data: result,
    };
  }

  // Admin từ chối yêu cầu
  @Patch('requests/:id/reject')
  async rejectRequest(@Param('id') id: string, @Body('reason') reason: string) {
    const result = await this.adminService.rejectRequest(
      id,
      'REJECTED',
      reason,
    );
    return {
      message: 'Yêu cầu đã bị từ chối',
      data: result,
    };
  }

  // =========== Thống kê tổng quan cho dashboard admin ================
  @Get('/stats/overview')
  async getOverviewStats() {
    const stats = await this.adminService.getOverviewStats();
    return { data: stats };
  }

  // =========== Hoạt động gần đây nhất (recent activities) cho dashboard admin ================
  @Get('/stats/activities-recent')
  async getRecentActivities() {
    const activities = await this.adminService.getRecentActivities();
    return { data: activities };
  }
}
