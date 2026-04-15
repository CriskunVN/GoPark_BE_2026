import { IsISO8601, IsNotEmpty } from 'class-validator';

export class CheckAvailableSlotsDto {
  @IsNotEmpty()
  @IsISO8601()
  start_time: string;

  @IsNotEmpty()
  @IsISO8601()
  end_time: string;
}
