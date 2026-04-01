import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateZoneDto {
  @IsString()
  @IsNotEmpty()
  zone_name: string;

  @IsNumber()
  @Min(0)
  total_slots: number;

  @IsString()
  @IsOptional()
  description?: string;
}
