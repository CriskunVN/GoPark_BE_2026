// src/chatbot/guards/optional-auth.guard.ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/**
 * Guard không bắt buộc đăng nhập.
 * - Có token hợp lệ → set req.user, tiếp tục
 * - Không có token / token lỗi → vẫn tiếp tục (req.user = undefined)
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader: string = request.headers['authorization'] ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) return true; // không có token → ok, tiếp tục

    try {
      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
      request.user = payload; // gắn user vào request
    } catch {
      // token lỗi → bỏ qua, không throw
      request.user = undefined;
    }

    return true;
  }
}