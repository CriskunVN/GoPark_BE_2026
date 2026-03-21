import { Injectable, NotFoundException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { UserResDto } from '../users/dto/user-res.dto';
import { Not } from 'typeorm';
import { UserStatus } from 'src/common/enums/userStatus.enum';

@Injectable()
export class AdminService {
  constructor(private readonly userService: UsersService) {}

  //Admin có thể xem tất cả người dùng
  async findAllUsers(page = 1, limit = 10) {
    const { items, meta } = await this.userService.findAllPaginated(
      page,
      limit,
    );

    const data = UserResDto.fromEntities(items ?? []);

    return {
      success: true,
      message: 'Lấy danh sách tài khoản thành công',
      data,
      meta: {
        ...meta,
        itemCount: data.length, // Cập nhật lại itemCount dựa trên số lượng phần tử thực tế trong data
      },
    };
  }

  async findAllOwners(page = 1, limit = 10) {
    const { items, meta } = await this.userService.findAllOwners(page, limit);

    return {
      success: true,
      message: 'Lấy danh sách chủ bãi thành công',
      data: items,
      meta,
    };
  }

  async blockUser(id: string, status: string) {
    if (status === UserStatus.BLOCKED) {
      await this.userService.update(id, { status: UserStatus.BLOCKED });
      return {
        message: 'Người dùng đã bị khóa',
      };
    } else if (status === UserStatus.ACTIVE) {
      await this.userService.update(id, { status: UserStatus.ACTIVE });
      return {
        message: 'Người dùng đã được mở khóa',
      };
    } else {
      throw new NotFoundException('Trạng thái không hợp lệ');
    }
  }
}
