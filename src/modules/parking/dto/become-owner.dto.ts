import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class BecomeOwnerDto {
  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsNotEmpty()
  parkingLotName: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsString()
  @IsOptional()
  taxCode: string;

  @IsString()
  @IsOptional()
  description: string;

  @IsNotEmpty()
  lat: string | number;

  @IsNotEmpty()
  lng: string | number;

  @IsNotEmpty()
  floors: string | number;

  @IsNotEmpty()
  floorSlots: string; // JSON string from frontend

  @IsOptional()
  avatarIndex?: string | number;
}