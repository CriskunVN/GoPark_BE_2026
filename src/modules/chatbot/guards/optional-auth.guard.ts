// src/chatbot/guards/optional-auth.guard.ts
import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/**
 * Guard không bắt buộc đăng nhập.
 * - Có token hợp lệ → set req.user, tiếp tục
 * - Không có token / token lỗi → vẫn tiếp tục (req.user = undefined)
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  private readonly logger = new Logger(OptionalAuthGuard.name);

  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader: string = request.headers['authorization'] ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    // ✅ Debug: log để kiểm tra
    this.logger.debug(`Auth header present: ${!!authHeader}`);
    this.logger.debug(`Token extracted: ${token ? 'YES (length: ' + token.length + ')' : 'NO'}`);

    if (!token) {
      this.logger.debug('No token found, continuing without user');
      return true; // không có token → ok, tiếp tục
    }

    try {
      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
      request.user = payload; // gắn user vào request
      
      // ✅ Debug: log user info
      this.logger.debug(`Token verified successfully. User ID: ${payload.sub || payload.id}`);
      this.logger.debug(`User payload: ${JSON.stringify({ sub: payload.sub, email: payload.email })}`);
    } catch (error) {
      // ✅ Debug: log lỗi verify
      this.logger.warn(`Token verification failed: ${error.message}`);
      request.user = undefined;
    }

    return true;
  }
}