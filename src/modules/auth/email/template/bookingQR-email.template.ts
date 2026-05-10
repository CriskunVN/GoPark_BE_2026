export const getBookingQREmailTemplate = (
  userName: string,
  qrImageUrl: string,
  parkingLot: string,
  startTime: string,
  endTime: string,
  code: string,
  floor_number: number,
  floor_zone: string,
  logoUrl?: string,
): string => {
  const brandName = 'GoPark';
  return `
    <!doctype html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; background-color: #f4f7f6; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f7f6; padding: 40px 15px;">
        <tr>
          <td align="center">
            <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 20px rgba(0,0,0,0.06); margin: 0 auto; border: 1px solid #eaeaea;">
              
              <!-- Header / Logo -->
              <tr>
                <td style="background-color: #c8e6c9; padding: 30px; text-align: center;">
                  ${
                    logoUrl
                      ? `<img src="${logoUrl}" height="50" alt="${brandName}" style="display: block; margin: 0 auto; border: 0;">`
                      : `<h1 style="color: #ffffff; margin: 0; font-size: 28px; letter-spacing: 1.5px;">${brandName}</h1>`
                  }
                </td>
              </tr>

              <!-- Main Content -->
              <tr>
                <td style="padding: 40px 30px;">
                  <h2 style="margin: 0 0 15px 0; color: #1a1a1a; font-size: 22px;">Xin chào ${userName},</h2>
                  <p style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #555555;">
                    Chúc mừng bạn đã đặt chỗ thành công tại bãi xe <strong style="color: #1e7e34;">${parkingLot}</strong>. Dưới đây là thông tin chi tiết về lượt gửi xe của bạn.
                  </p>

                  <!-- Thông tin vé / Ticket Card -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e0e6ed; border-radius: 12px; background-color: #fafbfc; overflow: hidden;">
                    
                    <!-- QR Code Section -->
                    <tr>
                      <td align="center" style="padding: 30px; border-bottom: 2px dashed #d1d9e6;">
                        <p style="margin: 0 0 15px 0; font-size: 13px; color: #1e7e34; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px;">Mã QR Định Danh</p>
                        
                        <div style="background: #ffffff; padding: 12px; display: inline-block; border-radius: 10px; border: 1px solid #eaeaea; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
                          <img src="${qrImageUrl}" width="200" height="200" style="display: block; border: none; outline: none; text-decoration: none;" alt="Mã QR GoPark">
                        </div>
                        
                      </td>
                    </tr>

                    <!-- Details Section -->
                    <tr>
                      <td style="padding: 25px 30px; background-color: #ffffff;">
                        <table width="100%" cellpadding="0" cellspacing="0">
                          <!-- Row 1: Time -->
                          <tr>
                            <td style="padding-bottom: 20px; border-bottom: 1px solid #f0f0f0;" width="50%" valign="top">
                              <span style="color: #666666; font-size: 13px; display: block; margin-bottom: 6px;">Thời gian vào</span>
                              <strong style="color: #222222; font-size: 15px;">${startTime}</strong>
                            </td>
                            <td style="padding-bottom: 20px; border-bottom: 1px solid #f0f0f0; text-align: right;" width="50%" valign="top">
                              <span style="color: #666666; font-size: 13px; display: block; margin-bottom: 6px;">Thời gian ra (dự kiến)</span>
                              <strong style="color: #222222; font-size: 15px;">${endTime}</strong>
                            </td>
                          </tr>
                          
                          <!-- Row 2: Location -->
                          <tr>
                            <td colspan="2" style="padding-top: 25px;">
                              <span style="color: #666666; font-size: 13px; display: block; margin-bottom: 12px;">Vị trí đỗ xe của bạn</span>
                              
                              <table cellpadding="0" cellspacing="0">
                                <tr>
                                  <td style="background-color: #2b9b47; color: #ffffff; padding: 8px 16px; border-radius: 6px; font-weight: bold; font-size: 14px;">
                                    Khu ${floor_zone}
                                  </td>
                                  <td width="12"></td>
                                  <td style="background-color: #eef7f0; color: #1e7e34; padding: 8px 16px; border-radius: 6px; font-weight: bold; border: 1px solid #bce3c4; font-size: 14px;">
                                    Tầng ${floor_number}
                                  </td>
                                  <td width="12"></td>
                                  <td style="background-color: #eef7f0; color: #1e7e34; padding: 8px 16px; border-radius: 6px; font-weight: bold; border: 1px solid #bce3c4; font-size: 14px;">
                                    Ô ${code}
                                  </td>
                                </tr>
                              </table>

                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>

                  <p style="font-size: 14px; color: #555555; text-align: center; margin-top: 30px; font-style: italic;font-weight: bold;">
                    * Vui lòng xuất trình mã QR này cho nhân viên hoặc quét tại máy kiểm soát vé ở cổng.
                  </p>
                </td>
              </tr>

              <!-- Footer Section -->
              <tr>
                <td style="background-color: #f8f9fa; padding: 25px 30px; text-align: center; border-top: 1px solid #eaeaea;">
                  <p style="margin: 0 0 10px 0; font-size: 13px; color: #666666;">
                    © ${new Date().getFullYear()} ${brandName} System. All rights reserved.
                  </p>
                  <p style="margin: 0; font-size: 12px; color: #888888;">
                    Email này được tạo và gửi tự động. Vui lòng không trả lời trực tiếp hộp thư này.
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
};
