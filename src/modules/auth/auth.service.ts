import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { LoginDto } from './dto/login.dto';
import * as nodemailer from 'nodemailer';
import { getVerificationEmailTemplate } from './email/template/verification-email.template';
import { EmailService } from './email/email.service';
import { UserResDto } from '../users/dto/user-res.dto';

@Injectable()
export class AuthService {
  // Khởi tạo transporter trong constructor để sử dụng cho việc gửi email xác thực
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
  ) {}

  // Hàm để tạo access token và refresh token
  async getTokens(userId: string, email: string, roles: string[]) {
    const [at, rt] = await Promise.all([
      this.jwtService.signAsync(
        { sub: userId, email, roles }, // Thêm roles vào payload
        {
          secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
          expiresIn: '15m', // thời gian  của access token.
        },
      ),
      this.jwtService.signAsync(
        { sub: userId, email, roles },
        {
          secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
          expiresIn: '7d', // thời gian  của refresh token.
        },
      ),
    ]);

    return {
      access_token: at,
      refresh_token: rt,
    };
  }

  // Hàm để lưu hash của refresh token vào database, hash này sẽ được so sánh khi client gửi refresh token mới để cấp lại access token
  async updateRefreshTokenHash(userId: string, rt: string) {
    const hash = await bcrypt.hash(rt, 10);
    await this.usersService.update(userId, { refreshToken: hash }); // Cập nhật hash của refresh token vào database
  }

  // Register
  async register(registerDto: RegisterDto) {
    if (registerDto.password !== registerDto.confirmPassword) {
      throw new BadRequestException('Mật khẩu nhập lại không khớp');
    }

    const existingUser = await this.usersService.findByEmail(registerDto.email);
    if (existingUser) {
      throw new BadRequestException('Email này đã được sử dụng');
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);
    const verifyToken = crypto.randomBytes(32).toString('hex');

    const { confirmPassword, ...userDetails } = registerDto;

    const newUser = await this.usersService.create({
      ...userDetails,
      password: hashedPassword,
      verifyToken,
    });

    await this.emailService.sendVerificationEmail(newUser.email, verifyToken); // Gửi email xác thực sau khi tạo người dùng mới

    // Trả về DTO an toàn, không lộ các trường nhạy cảm
    return UserResDto.fromEntity(newUser);
  }

  // Login
  async login(loginDto: LoginDto) {
    const user = await this.usersService.findByEmail(loginDto.email); // Tìm người dùng theo email để kiểm tra thông tin đăng nhập
    if (!user)
      throw new UnauthorizedException(
        'Tài khoản không tồn tại hoặc thông tin đăng nhập không hợp lệ',
      );

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException(
        'Tài khoản chưa được xác minh. Vui lòng kiểm tra email của bạn.',
      );
    }

    const isMatch = await bcrypt.compare(loginDto.password, user.password); // So sánh mật khẩu đã nhập với mật khẩu đã hash trong database
    if (!isMatch)
      throw new UnauthorizedException('Sai tài khoản hoặc mật khẩu');

    // Lấy danh sách role name
    const roles = user.userRoles?.map((ur) => ur.role.name) || [];

    const tokens = await this.getTokens(user.id, user.email, roles); // Tạo access token và refresh token cho người dùng
    await this.updateRefreshTokenHash(user.id, tokens.refresh_token); // Lưu hash của refresh token vào database để sử dụng cho việc cấp lại access token sau này

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      user: {
        ...UserResDto.fromEntity(user),
        role: roles[0] || 'user',
      },
    };
  }

  // Logout
  async logout(userId: string) {
    await this.usersService.update(userId, { refreshToken: null } as any); // Xóa hash của refresh token trong database để vô hiệu hóa refresh token hiện tại
  }

  // Refresh Token
  async refreshTokens(userId: string, rt: string) {
    const user = await this.usersService.findOne(userId); // Tìm người dùng theo ID để kiểm tra refresh token
    if (!user || !user.refreshToken)
      throw new ForbiddenException('Từ chối truy cập');

    const rtMatches = await bcrypt.compare(rt, user.refreshToken);
    if (!rtMatches) throw new ForbiddenException('Từ chối truy cập');

    // Lấy danh sách role name
    const roles = user.userRoles?.map((ur) => ur.role.name) || [];

    const tokens = await this.getTokens(user.id, user.email, roles); // Tạo access token và refresh token mới
    await this.updateRefreshTokenHash(user.id, tokens.refresh_token); // Lưu hash của refresh token mới vào database

    return tokens;
  }

  // Verify Email
  async verifyEmail(token: string) {
    const user = await this.usersService.findByVerifyToken(token); // Tìm người dùng theo mã xác thực để xác minh email
    if (!user) throw new BadRequestException('Mã xác thực không hợp lệ');

    if (user.status === 'ACTIVE') {
      return { message: 'Email đã được xác minh trước đó' };
    }

    await this.usersService.update(user.id, {
      status: 'ACTIVE',
      verifyToken: null,
    } as any);

    return { message: 'Xác minh email thành công' };
  }

  // Reset Password
  async resetPassword(email: string) {
    // Tìm người dùng theo email
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng với email này');
    }
    // Tạo token đặt lại mật khẩu và hash token này để lưu vào database
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = await bcrypt.hash(resetToken, 10);

    // Gửi email chứa link reset password
    try {
      // Cập nhật hash của reset token vào database
      await this.usersService.update(user.id, {
        resetPasswordToken: resetTokenHash,
      });

      // Gửi email reset password
      await this.emailService.sendResetPasswordEmail(user.email, resetToken);

      setTimeout(
        async () => {
          // Hết hạn token sau 15p và xóa hash của reset token khỏi database
          await this.usersService.update(user.id, {
            resetPasswordToken: null,
          } as any);
        },
        15 * 60 * 1000,
      ); // 15 phút

      // Trả về thông báo thành công - interceptor sẽ tự động wrap message
      return {
        message:
          'Vui lòng kiểm tra hộp thư của bạn để nhận hướng dẫn đặt lại mật khẩu.',
        data: {
          requested: true,
          expiresInMinutes: 15,
        },
      };
    } catch (e) {
      console.log('Email error: ', e);
      throw new BadRequestException('Không thể gửi email reset mật khẩu');
    }
  }

  // Xác nhận reset password
  async confirmResetPassword(
    token: string,
    email: string,
    newPassword: string,
  ) {
    // Tìm người dùng theo email
    const user = await this.usersService.findByEmail(email);
    console.log(user, email, token, newPassword);
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng với email này');
    }

    // Kiểm tra token reset password
    const isTokenValid = await bcrypt.compare(
      token,
      user.resetPasswordToken as string,
    );
    if (!isTokenValid) {
      throw new BadRequestException(
        'Token đặt lại mật khẩu không hợp lệ hoặc đã hết hạn',
      );
    }

    // Hash mật khẩu mới và cập nhật vào database, đồng thời xóa token reset password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.usersService.update(user.id, {
      password: hashedPassword,
      resetPasswordToken: null,
    } as any);

    return { message: 'Đặt lại mật khẩu thành công' };
  }
}
