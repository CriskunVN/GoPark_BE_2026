import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateBookingDto {
  @IsDateString()
  start_time: Date;

  @IsDateString()
  end_time: Date;

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
