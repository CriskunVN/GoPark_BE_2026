import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateParkingLotReqDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @Type(() => Number)
  @IsNumber()
  lat: number;

  @Type(() => Number)
  @IsNumber()
  lng: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  totalSlots: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  availableSlots?: number;

  @IsString()
  @IsOptional()
  status?: string;

  @IsUUID()
  @IsNotEmpty()
  ownerId: string;
}
