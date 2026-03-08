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
import { getVerificationEmailTemplate } from './email-templates/verification-email.template';

@Injectable()
export class AuthService {
  private transporter: nodemailer.Transporter;
// Khởi tạo transporter trong constructor để sử dụng cho việc gửi email xác thực
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get('EMAIL_HOST'),
      port: 587,
      secure: false, // đúng cho port 587, nếu dùng port 465 thì secure: true
      auth: {
        user: this.configService.get('EMAIL_USER'),
        pass: this.configService.get('EMAIL_PASS'),
      },
    });
  }

  // Hàm để tạo access token và refresh token
  async getTokens(userId: number, email: string, roles: string[]) {
    const [at, rt] = await Promise.all([
      this.jwtService.signAsync(
        { sub: userId, email, roles },  // Thêm roles vào payload
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
  async updateRefreshTokenHash(userId: number, rt: string) {
    const hash = await bcrypt.hash(rt, 10);
    await this.usersService.update(userId, { refreshToken: hash });// Cập nhật hash của refresh token vào database
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

    // Gửi email xác minh template
    const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
    const link = `${frontendUrl}/verify-email?token=${verifyToken}`;
    
    // Log link xác thực ra console để tiện test local
    console.log(`[TESTING] Verification Link: ${link}`);

    try {
        await this.transporter.sendMail({
        from: '"Hỗ trợ GoPark" <' + this.configService.get('EMAIL_FROM') + '>',
        to: newUser.email,
        subject: 'Xác minh địa chỉ email của bạn',
        html: getVerificationEmailTemplate(link), // Sử dụng template email
        });
    } catch (e) {
        console.log("Email error: ", e);
    }

    // trả về thông tin người dùng đã được tạo, loại bỏ password và refreshToken khỏi kết quả trả về
    const { password, refreshToken, ...result } = newUser;
    return result;
  }

  // Login
  async login(loginDto: LoginDto) {
    const user = await this.usersService.findByEmail(loginDto.email); // Tìm người dùng theo email để kiểm tra thông tin đăng nhập
    if (!user) throw new UnauthorizedException('Thông tin đăng nhập không hợp lệ');

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('Tài khoản chưa được xác minh. Vui lòng kiểm tra email của bạn.');
    }

    const isMatch = await bcrypt.compare(loginDto.password, user.password); // So sánh mật khẩu đã nhập với mật khẩu đã hash trong database
    if (!isMatch) throw new UnauthorizedException('Thông tin đăng nhập không hợp lệ');

    // Lấy danh sách role name
    const roles = user.userRoles?.map((ur) => ur.role.name) || [];

    const tokens = await this.getTokens(user.id, user.email, roles); // Tạo access token và refresh token cho người dùng
    await this.updateRefreshTokenHash(user.id, tokens.refresh_token); // Lưu hash của refresh token vào database để sử dụng cho việc cấp lại access token sau này

    return tokens;
  }

  // Logout
  async logout(userId: number) {
    await this.usersService.update(userId, { refreshToken: null } as any); // Xóa hash của refresh token trong database để vô hiệu hóa refresh token hiện tại
  }

  // Refresh Token
  async refreshTokens(userId: number, rt: string) {
    const user = await this.usersService.findOne(userId); // Tìm người dùng theo ID để kiểm tra refresh token
    if (!user || !user.refreshToken) throw new ForbiddenException('Từ chối truy cập');

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
        return { message: "Email đã được xác minh trước đó" };
    }

    await this.usersService.update(user.id, { 
        status: 'ACTIVE', 
        verifyToken: null 
    } as any);

    return { message: "Xác minh email thành công" };
  }
}
