import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateFloorDto {
  @IsString()
  @IsNotEmpty()
  floor_name: string;

  @IsNumber()
  @IsNotEmpty()
  floor_number: number;

  @IsString()
  @IsOptional()
  description?: string;
}
