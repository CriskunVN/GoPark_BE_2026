import { IsOptional, IsString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateParkingLotReqDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  lat?: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  lng?: number;

  @IsString()
  @IsOptional()
  description?: string;

  @IsOptional()
  open_time?: string;

  @IsOptional()
  close_time?: string;

  @IsString()
  @IsOptional()
  operating_days?: string;

  @IsOptional()
  images?: any;
}
