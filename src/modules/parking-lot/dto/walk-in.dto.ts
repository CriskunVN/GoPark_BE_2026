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

  @IsString()
  @IsNotEmpty()
  vehicleType: string;

  // Ảnh để null theo yêu cầu do chưa có Supabase
}
