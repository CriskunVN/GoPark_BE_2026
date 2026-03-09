import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { getVerificationEmailTemplate } from './verification-email.template';

@Injectable()
export class EmailService {
  private resend: Resend;

  constructor(private configService: ConfigService) {
    // Khởi tạo client Resend
    this.resend = new Resend(this.configService.get('RESEND_API_KEY'));
  }

  async sendEmail(to: string, subject: string, html: string) {
    try {
      const from = this.configService.get<string>('EMAIL_FROM');
      const data = await this.resend.emails.send({
        from: `Đội ngũ GoPark <${from}>`,
        to,
        subject,
        html,
      });
      console.log('Gửi email thành công: ' + to);
    } catch (error) {
      console.error('Lỗi khi gửi email:', error);
      throw new Error('Lỗi khi gửi email'); // Ném lỗi để controller có thể xử lý
    }
  }

  async sendVerificationEmail(to: string, link: string) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
    const verificationLink = `${frontendUrl}/api/v1/auth/verify-email?token=${link}`;

    // Log link xác thực ra console để tiện test local
    console.log(`[TESTING] Verification Link: ${verificationLink}`);

    await this.sendEmail(
      to,
      'Xác minh email của bạn',
      getVerificationEmailTemplate(verificationLink),
    );
  }
}
