import { CreateNotificationDto } from '../dto/create-notification.dto';

// Định nghĩa các loại job và dữ liệu liên quan cho hàng đợi thông báo
export enum NotificationJobType {
  SEND_TO_USERS = 'send_to_users',
  SEND_TO_ROLE = 'send_to_role',
  BROADCAST = 'broadcast',
}

// Dữ liệu cho job gửi thông báo đến một hoặc một vài người dùng
export interface SendToUsersJobData {
  type: NotificationJobType.SEND_TO_USERS;
  notificationDto: CreateNotificationDto;
  userIds: string[];
  jobId: string;
  requestedAt: string;
}

// Dữ liệu cho job gửi thông báo đến một vai trò cụ thể
export interface SendToRoleJobData {
  type: NotificationJobType.SEND_TO_ROLE;
  notificationDto: CreateNotificationDto;
  targetRole: string;
  jobId: string;
  requestedAt: string;
}

// Dữ liệu cho job gửi thông báo đến tất cả người dùng (broadcast)
export interface BroadcastJobData {
  type: NotificationJobType.BROADCAST;
  notificationDto: CreateNotificationDto;
  jobId: string;
  requestedAt: string;
  batchSize?: number; // Chia nhỏ broadcast thành batch
}

// Union type cho dữ liệu của tất cả các loại job
export type NotificationJobData =
  | SendToUsersJobData
  | SendToRoleJobData
  | BroadcastJobData;

// Kết quả trả về sau khi xử lý job
export interface NotificationJobResult {
  success: boolean;
  jobId: string;
  type: NotificationJobType;
  message: string;
  recipientCount?: number;
  failedCount?: number;
  processedAt: string;
}
