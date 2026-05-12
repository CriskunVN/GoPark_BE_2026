import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class PaginationDto {
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
}
