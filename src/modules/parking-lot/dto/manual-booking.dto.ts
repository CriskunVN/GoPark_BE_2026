import { IsDateString, IsInt, IsNotEmpty, IsString } from 'class-validator';

export class ManualBookingDto {
  @IsInt()
  @IsNotEmpty()
  slotId: number;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsString()
  @IsNotEmpty()
  licensePlate: string;

  @IsDateString()
  @IsNotEmpty()
  startTime: string;
}
