// src/chatbot/guards/auth.guard.ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    const authHeader: string = request.headers['authorization'] ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      throw new UnauthorizedException(
        'Bạn cần đăng nhập để kiểm tra trạng thái chatbot.',
      );
    }

    // Nếu có JwtService thì verify ở đây:
    // const payload = this.jwtService.verify(token);
    // request.user = payload;

    return true;
  }
}