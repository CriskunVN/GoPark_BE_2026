import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Req,
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
  async approveRequest(
    @Param('id') id: string,
    @Req() req: any,
    @Body('reason') reason: string,
  ) {
    const adminId = req.user?.userId || req.user?.id; // Tùy thuộc vào payload của JWT
    const result = await this.adminService.approveRequest(id, adminId, reason);
    return {
      message: 'Yêu cầu đã được phê duyệt',
      data: result,
    };
  }

  // Admin từ chối yêu cầu
  @Patch('requests/:id/reject')
  async rejectRequest(
    @Param('id') id: string,
    @Req() req: any,
    @Body('reason') reason: string,
  ) {
    const adminId = req.user?.userId || req.user?.id;
    const result = await this.adminService.rejectRequest(id, adminId, reason);
    return {
      message: 'Yêu cầu đã bị từ chối',
      data: result,
    };
  }

  @Get('/stats/requests')
  async getRequestStats() {
    const stats = await this.adminService.getRequestStats();
    return { data: stats };
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

  // =========== Thống kê quản lý người dùng ================
  @Get('/stats/users')
  async getUserStats() {
    const stats = await this.adminService.getUserStats();
    return { data: stats };
  }

  // =========== Lấy danh sách người dùng ================
  @Get('/users/list')
  async getUserList(
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('search') search?: string,
  ) {
    const data = await this.adminService.getUserList(
      Number(page),
      Number(limit),
      search,
    );
    return {
      message: 'Lấy danh sách người dùng thành công',
      data,
    };
  }

  @Get('/stats/owners')
  async getOwnerStats() {
    const stats = await this.adminService.getOwnerStats();
    return { data: stats };
  }

  @Get('/owners/list')
  async getOwnerList(
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('search') search?: string,
  ) {
    const data = await this.adminService.getOwnerList(
      Number(page),
      Number(limit),
      search,
    );
    return {
      message: 'Lấy danh sách chủ bãi thành công',
      data,
    };
  }

  // =========== Stats Parking Lot ================
  @Get('/stats/parking-lots')
  async getParkingLotStats() {
    const stats = await this.adminService.getParkingLotStats();
    return { data: stats };
  }

  // ========== Get danh sách bãi đỗ xe  ================
  @Get('/parking-lots/list')
  async getParkingLotList(
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('search') search?: string,
  ) {
    const data = await this.adminService.getParkingLotList(
      Number(page),
      Number(limit),
      search,
    );
    return {
      message: 'Lấy danh sách bãi đỗ xe thành công',
      data,
    };
  }

  // =========== Thống kê giao dịch ================
  @Get('/stats/transactions')
  async getTransactionStats() {
    const stats = await this.adminService.getTransactionStats();
    return { data: stats };
  }

  // =========== Get danh sách giao dịch  ================
  @Get('/transactions/list')
  async getTransactionList(
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('search') search?: string,
  ) {
    const data = await this.adminService.getTransactionList(
      Number(page),
      Number(limit),
      search,
    );
    return {
      message: 'Lấy danh sách giao dịch thành công',
      data,
    };
  }
}
