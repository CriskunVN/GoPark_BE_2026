import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err, user, info) {
    if (err || !user) { // Nếu có lỗi hoặc không có user nào được xác thực, ném ra lỗi UnauthorizedException với thông báo yêu cầu đăng nhập
      throw err || new UnauthorizedException('Vui lòng đăng nhập để tiếp tục');
    }
    return user;
  }
}