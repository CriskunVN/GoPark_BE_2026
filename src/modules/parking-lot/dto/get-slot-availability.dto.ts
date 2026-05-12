import { IsISO8601, IsNotEmpty } from 'class-validator';

export class GetSlotAvailabilityDto {
  @IsNotEmpty()
  @IsISO8601()
  date: string;
}
