import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateVehicleDto {
  @IsNotEmpty()
  @IsString()
  plate_number: string;

  @IsOptional()
  @IsString()
  image?: string;
}

export class UpdateVehicleDto {
  @IsOptional()
  @IsString()
  plate_number?: string;

  @IsOptional()
  @IsString()
  image?: string;
}
