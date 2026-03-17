import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import {
  getVerificationEmailTemplate,
  getVerificationEmailTextTemplate,
} from './template/verification-email.template';
import {
  getResetPasswordEmailTemplate,
  getResetPasswordEmailTextTemplate,
} from './template/resetPassword-email.template';

@Injectable()
export class EmailService {
  private resend: Resend;

  constructor(private configService: ConfigService) {
    // Khởi tạo client Resend
    this.resend = new Resend(this.configService.get('RESEND_API_KEY'));
  }

  async sendEmail(to: string, subject: string, html: string, text?: string) {
    try {
      const from = this.configService.get<string>('EMAIL_FROM');
      const senderName =
        this.configService.get<string>('EMAIL_FROM_NAME') || 'GoPark';
      const data = await this.resend.emails.send({
        from: `${senderName} <${from}>`,
        to,
        subject,
        html,
        text,
      });
      console.log('Gửi email thành công: ' + to);
    } catch (error) {
      console.error('Lỗi khi gửi email:', error);
      throw new Error('Lỗi khi gửi email'); // Ném lỗi để controller có thể xử lý
    }
  }

  async sendVerificationEmail(to: string, link: string) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
    const logoUrl = this.configService.get<string>('EMAIL_LOGO_URL');
    const verificationLink = `${frontendUrl}/auth/verify-email?token=${link}`;

    // Log link xác thực ra console để tiện test local
    console.log(`[TESTING] Verification Link: ${verificationLink}`);

    await this.sendEmail(
      to,
      'Xác minh email của bạn',
      getVerificationEmailTemplate(verificationLink, logoUrl),
      getVerificationEmailTextTemplate(verificationLink),
    );
  }

  async sendResetPasswordEmail(to: string, resetToken: string) {
    const frontendUrl =
      this.configService.get('FRONTEND_URL') || 'http://localhost:3000';
    const logoUrl = this.configService.get<string>('EMAIL_LOGO_URL');
    const resetLink = `${frontendUrl}/auth/reset-password?token=${resetToken}&email=${to}`; // phải sửa lại URL page reset password trên frontend để nhận token và email qua query params

    console.log(`Reset token : ${resetToken} | ${to}`);

    await this.sendEmail(
      to,
      'Yêu cầu đặt lại mật khẩu',
      getResetPasswordEmailTemplate(resetLink, logoUrl),
      getResetPasswordEmailTextTemplate(resetLink),
    );
  }
}
