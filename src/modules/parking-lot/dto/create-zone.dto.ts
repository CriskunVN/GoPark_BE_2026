import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateZoneDto {
  @IsString()
  @IsNotEmpty()
  zone_name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  prefix: string; // VD: 'A', 'B', 'VIP' — tiền tố cho mã slot

  @IsNumber()
  @Min(0)
  total_slots: number;

  @IsString()
  @IsOptional()
  description?: string;
}
