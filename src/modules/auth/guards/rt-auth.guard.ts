import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class RtAuthGuard extends AuthGuard('jwt-refresh') {
  handleRequest(err, user, info) {
    if (err || !user) { // Nếu có lỗi hoặc không có user nào được xác thực, ném ra lỗi UnauthorizedException với thông báo mã không hợp lệ hoặc đã hết hạn
      throw err || new UnauthorizedException('Mã không hợp lệ hoặc đã hết hạn');
    }
    return user;
  }
}