import { IsString, IsNotEmpty } from 'class-validator';

export class WalkInDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsString()
  @IsNotEmpty()
  licensePlate: string;

  // Ảnh để null theo yêu cầu do chưa có Supabase
}
