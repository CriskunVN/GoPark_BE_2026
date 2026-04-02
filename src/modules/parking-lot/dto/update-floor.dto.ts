import { IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateFloorDto {
  @IsString()
  @IsOptional()
  floor_name?: string;

  @IsNumber()
  @IsOptional()
  floor_number?: number;

  @IsString()
  @IsOptional()
  description?: string;
}
