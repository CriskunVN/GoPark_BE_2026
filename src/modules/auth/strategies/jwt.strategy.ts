import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false, // Không bỏ qua việc kiểm tra hết hạn của token
      secretOrKey: configService.get<string>('JWT_ACCESS_SECRET')!,
    });
  }
// Hàm validate sẽ được gọi sau khi token đã được xác thực thành công, payload chứa thông tin đã được mã hóa trong token
  async validate(payload: any) {
    return { userId: payload.sub, email: payload.email, roles: payload.roles };
  }
}