import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { NotificationType } from 'src/common/enums/type.enum';
import { Type } from 'class-transformer';

/**
 * DTO cho bảng hiển thị thông báo
 */
export class NotificationTableItemDto {
  id: string;
  title: string; // THÔNG BÁO
  content?: string; // NỘI DUNG THÔNG BÁO
  type: string; // LOẠI (SYSTEM, PROMOTIONAL, etc)
  targetRole: string; // ĐỐI TƯỢNG (ALL, ADMIN, USER, etc)
  isRead: boolean; // ĐÃ ĐỌC (true = Đã đọc, false = Chưa đọc)
  readSummary?: string; // Số đã đọc / tổng số người nhận
  recipientCount?: number; // Tổng số người nhận
  readCount?: number; // Số người đã đọc
  status: string; // TRẠNG THÁI (SENT, FAILED, PENDING)
  createdAt: Date; // THỜI GIAN
  readAt?: Date | null; // Thời gian đọc
}

/**
 * DTO query để lấy danh sách thông báo cho bảng
 */
export class GetNotificationTableDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1; // Trang hiện tại, mặc định 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10; // Số phần tử mỗi trang, mặc định 10

  @IsOptional()
  @IsString()
  search?: string; // Tìm kiếm theo tiêu đề (title)

  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType; // Lọc theo loại thông báo

  @IsOptional()
  @IsString()
  sortBy?: 'createdAt' | 'readAt' = 'createdAt'; // Sắp xếp theo trường nào

  @IsOptional()
  @IsString()
  sortOrder?: 'ASC' | 'DESC' = 'DESC'; // Thứ tự sắp xếp

  @IsOptional()
  @IsString()
  status?: 'read' | 'unread'; // Lọc theo trạng thái đã đọc
}

/**
 * Response DTO cho danh sách thông báo (pagination)
 */
export class NotificationTableResponseDto {
  items: NotificationTableItemDto[];
  total: number; // Tổng số thông báo
  page: number; // Trang hiện tại
  limit: number; // Số phần tử mỗi trang
  totalPages: number; // Tổng số trang
  hasNextPage: boolean; // Có trang tiếp theo không
  hasPreviousPage: boolean; // Có trang trước không
}
