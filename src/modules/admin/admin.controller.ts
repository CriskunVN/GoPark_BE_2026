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
}
