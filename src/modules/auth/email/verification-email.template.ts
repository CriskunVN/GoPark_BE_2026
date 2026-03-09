export const getVerificationEmailTemplate = (link: string): string => {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h1 style="color: #10b981; margin: 0;">GoPark</h1>
      </div>
      <h2 style="color: #333;">Chào mừng bạn đến với GoPark!</h2>
      <p style="color: #555; line-height: 1.6;">Cảm ơn bạn đã đăng ký tài khoản. Để hoàn tất quá trình đăng ký và bắt đầu sử dụng dịch vụ, vui lòng xác minh địa chỉ email của bạn bằng cách nhấp vào nút bên dưới:</p>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${link}" style="background-color: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Xác minh Email Ngay</a>
      </div>
      
      <p style="color: #555; line-height: 1.6;">Nếu nút trên không hoạt động, bạn có thể sao chép và dán liên kết sau vào trình duyệt:</p>
      <p style="background-color: #f5f5f5; padding: 10px; border-radius: 4px; word-break: break-all; color: #666; font-size: 14px;">${link}</p>
      
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="color: #888; font-size: 12px; text-align: center;">Nếu bạn không yêu cầu đăng ký tài khoản này, vui lòng bỏ qua email này.</p>
      <p style="color: #888; font-size: 12px; text-align: center;">&copy; ${new Date().getFullYear()} GoPark. All rights reserved.</p>
    </div>
  `;
};
