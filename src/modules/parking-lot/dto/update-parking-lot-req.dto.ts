import { IsOptional, IsString } from 'class-validator';

export class UpdateParkingLotReqDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsOptional()
  images?: any;
}
