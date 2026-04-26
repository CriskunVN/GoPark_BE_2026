export const expirationReminderTemplate = (data: {
  userName: string;
  lotName: string;
  plateNumber: string;
  endTimeStr: string;
}) => `
<div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e1e1e1; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
  <div style="background-color: #003580; padding: 24px; text-align: center;">
    <h1 style="color: #ffffff; margin: 0; font-size: 28px; letter-spacing: 1px;">GoPark</h1>
    <p style="color: #e0e0e0; margin: 8px 0 0 0; font-size: 14px;">Hệ thống quản lý đỗ xe thông minh</p>
  </div>
  <div style="padding: 32px;">
    <h2 style="color: #333333; margin-top: 0; font-size: 20px;">Chào ${data.userName},</h2>
    <p style="color: #555555; line-height: 1.6; font-size: 16px;">
      Hệ thống GoPark xin thông báo lượt đỗ xe của bạn <span style="font-weight: bold; color: #d32f2f;">sắp hết hạn</span>.
    </p>
    <div style="background-color: #f8f9fa; border-left: 4px solid #003580; padding: 20px; border-radius: 4px; margin: 24px 0;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #666666; width: 35%; font-size: 14px;">📍 Bãi đỗ:</td>
          <td style="padding: 8px 0; color: #333333; font-weight: bold; font-size: 15px;">${data.lotName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666666; font-size: 14px;">🚗 Biển số xe:</td>
          <td style="padding: 8px 0; color: #333333; font-weight: bold; font-size: 15px;">${data.plateNumber}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666666; font-size: 14px;">⏰ Hết hạn lúc:</td>
          <td style="padding: 8px 0; color: #d32f2f; font-weight: bold; font-size: 18px;">${data.endTimeStr}</td>
        </tr>
      </table>
    </div>
    <p style="color: #555555; line-height: 1.6; font-size: 15px;">
      Vui lòng di chuyển xe hoặc truy cập ứng dụng để <strong>gia hạn thêm thời gian</strong>.
    </p>
  </div>
  <div style="padding: 24px; background-color: #f8f9fa; text-align: center; border-top: 1px solid #eeeeee;">
    <p style="color: #888888; font-size: 12px; margin: 0;">
      © 2026 GoPark Team. All rights reserved.
    </p>
  </div>
</div>
`;