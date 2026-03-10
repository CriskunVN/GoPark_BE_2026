const escapeHtml = (value: string): string => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

export const getResetPasswordEmailTemplate = (
  link: string,
  logoUrl?: string,
): string => {
  const safeLink = escapeHtml(link);
  const safeLogoUrl = logoUrl ? escapeHtml(logoUrl) : '';
  const currentYear = new Date().getFullYear();
  const brandName = 'GoPark';

  return `<!doctype html>
<html lang="vi">
	<head>
		<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>Đặt lại mật khẩu ${brandName}</title>
	</head>
	<body style="margin:0;padding:0;background-color:#eef2f7;font-family:Arial,Helvetica,sans-serif;color:#111827;">
		<div style="display:none;font-size:1px;color:#eef2f7;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
			Yêu cầu đặt lại mật khẩu tài khoản ${brandName} của bạn.
		</div>

		<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#eef2f7;padding:30px 12px;">
			<tr>
				<td align="center">
					<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background:#ffffff;border:1px solid #dde3ec;border-radius:16px;overflow:hidden;">
						<tr>
							<td style="padding:0;height:6px;background:linear-gradient(90deg,#0f172a 0%,#10b981 100%);"></td>
						</tr>

						<tr>
							<td style="padding:28px 28px 8px;text-align:center;">
								<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
									<tr>
										<td align="center" style="padding-bottom:10px;">
											${
                        safeLogoUrl
                          ? `<img src="${safeLogoUrl}" width="72" height="72" alt="${brandName} logo" style="display:block;width:72px;height:72px;border-radius:18px;border:1px solid #e5e7eb;background:#ffffff;object-fit:contain;padding:6px;box-sizing:border-box;box-shadow:0 6px 20px rgba(17,24,39,0.08);" />`
                          : `<div style="width:70px;height:70px;border-radius:18px;background:#ffffff;border:1px solid #e5e7eb;display:inline-block;line-height:70px;text-align:center;box-shadow:0 6px 20px rgba(17,24,39,0.08);">
												<span style="font-size:30px;font-weight:800;line-height:70px;color:#0f172a;letter-spacing:1px;">GP</span>
											</div>`
                      }
										</td>
									</tr>
									<tr>
										<td align="center">
											<h1 style="margin:0;font-size:30px;line-height:1.2;color:#10b981;font-weight:800;">${brandName}</h1>
										</td>
									</tr>
								</table>
							</td>
						</tr>

						<tr>
							<td style="padding:8px 34px 0;">
								<h2 style="margin:0 0 14px;font-size:24px;line-height:1.35;color:#0f172a;font-weight:700;">Đặt lại mật khẩu</h2>
								<p style="margin:0 0 14px;font-size:15px;line-height:1.75;color:#334155;">
									Chúng tôi đã nhận được yêu cầu đặt lại mật khẩu cho tài khoản <strong>${brandName}</strong> của bạn.
									Nhấn nút bên dưới để tạo mật khẩu mới.
								</p>
								<p style="margin:0 0 10px;font-size:14px;line-height:1.7;color:#475569;">
									Vì lý do bảo mật, liên kết này nên được sử dụng sớm và chỉ dùng một lần.
								</p>
							</td>
						</tr>

						<tr>
							<td align="center" style="padding:20px 34px 10px;">
								<a href="${safeLink}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:13px 26px;border-radius:10px;letter-spacing:0.2px;">
									Đặt lại mật khẩu
								</a>
							</td>
						</tr>

						<tr>
							<td style="padding:12px 34px 8px;">
								<p style="margin:0 0 10px;font-size:14px;line-height:1.7;color:#475569;">
									Nếu nút không hoạt động, hãy sao chép và dán liên kết sau vào trình duyệt:
								</p>
								<p style="margin:0;padding:12px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;font-size:13px;line-height:1.65;color:#334155;word-break:break-all;">
									${safeLink}
								</p>
							</td>
						</tr>

						<tr>
							<td style="padding:16px 34px 28px;">
								<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#64748b;">
									Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này và kiểm tra bảo mật tài khoản.
								</p>
								<p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">
									Email này được gửi tự động cho mục đích bảo mật tài khoản.
								</p>
							</td>
						</tr>
					</table>

					<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;">
						<tr>
							<td style="padding:14px 8px 0;text-align:center;font-size:12px;color:#94a3b8;line-height:1.6;">
								© ${currentYear} ${brandName}. All rights reserved.
							</td>
						</tr>
					</table>
				</td>
			</tr>
		</table>
	</body>
</html>`;
};

export const getResetPasswordEmailTextTemplate = (link: string): string => {
  return [
    'GoPark - Đặt lại mật khẩu',
    '',
    'Chúng tôi đã nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.',
    'Vui lòng mở liên kết bên dưới để tạo mật khẩu mới:',
    link,
    '',
    'Nếu bạn không yêu cầu thao tác này, vui lòng bỏ qua email.',
  ].join('\n');
};
