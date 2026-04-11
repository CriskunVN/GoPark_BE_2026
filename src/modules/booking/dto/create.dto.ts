import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator';

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

  @IsOptional()
  @IsDateString()
  created_at?: Date;
}
