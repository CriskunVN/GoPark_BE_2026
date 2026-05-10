import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateBookingDto {
  @IsString()
  start_time: string;

  @IsString()
  end_time: string;

  @IsString()
  status: string;

  @IsString()
  user_id: string;

  @IsNumber()
  vehicle_id: number;

  @IsNumber()
  slot_id: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  sub_total?: number;

  @IsOptional()
  @IsString()
  voucher_code?: string;

  @IsOptional()
  @IsDateString()
  created_at?: Date;
}
