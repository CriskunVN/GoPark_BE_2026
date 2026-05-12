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
import { getBookingQREmailTemplate } from './template/bookingQR-email.template';
import { expirationReminderTemplate } from './template/expiration-reminder.template';
import * as QRCode from 'qrcode';

@Injectable()
export class EmailService {
  private resend: Resend;

  constructor(private configService: ConfigService) {
    // Khởi tạo client Resend
    this.resend = new Resend(this.configService.get('RESEND_API_KEY'));
  }

  async sendEmail(
    to: string,
    subject: string,
    html: string,
    text?: string,
    attachments?: any[],
  ) {
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
        attachments,
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

  // send QR
  async sendBookingQREmail(to: string, userName: string, bookingData: any) {
    console.log('Dữ liệu qrContent nhận được:', bookingData.qrContent);
    console.log(bookingData);
    const logoUrl = this.configService.get<string>('EMAIL_LOGO_URL') || '';

    // Encode chuỗi nội dung để đảm bảo chuỗi không làm hỏng cú pháp URL
    const encodedQRContent = encodeURIComponent(bookingData.qrContent);
    // Sử dụng API tạo ảnh QR. ecc=H tương đương với Error Correction Level 'H'
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodedQRContent}&ecc=H`;

    const html = getBookingQREmailTemplate(
      userName,
      qrImageUrl, // Truyền trực tiếp Link URL hình ảnh vào đây
      bookingData.parkingLot,
      bookingData.startTime,
      bookingData.endTime || 'N/A',
      bookingData.code,
      bookingData.floor_number,
      bookingData.floor_zone,
      logoUrl,
    );

    // Ở frontend gửi qua, nếu thích bảo mật bạn có thể dùng API đệm, nhưng mã QR định danh thường có thể truyền trực tiếp
    await this.sendEmail(to, '[GoPark] Vé QR của bạn', html);
  }

  //sendExpirationReminderEmail
  async sendExpirationReminderEmail(
    to: string, 
    userName: string, 
    reminderData: {
      lotName: string,
      plateNumber: string,
      endTimeStr: string
    }
  ) {
    const html = expirationReminderTemplate({
      userName,
      lotName: reminderData.lotName,
      plateNumber: reminderData.plateNumber,
      endTimeStr: reminderData.endTimeStr,
    });

    const text = `Chào ${userName}, lượt đỗ xe ${reminderData.plateNumber} tại ${reminderData.lotName} sẽ hết hạn vào lúc ${reminderData.endTimeStr}.`;

    await this.sendEmail(
      to, 
      `[GoPark] Nhắc nhở: Sắp hết hạn đỗ xe - ${reminderData.plateNumber}`, 
      html, 
      text
    );
  }
}
