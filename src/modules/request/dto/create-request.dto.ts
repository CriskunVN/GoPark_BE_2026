import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { RequestType } from '../entities/request.entity';
import { Type } from 'class-transformer';

export enum ParkingImageDocType {
  BUSINESS_LICENSE = 'business_license',
  PARKING_LAYOUT = 'parking_layout',
  OTHER = 'other',
}

export class ParkingLotDocumentDto {
  @IsEnum(ParkingImageDocType)
  type: ParkingImageDocType;

  @IsString()
  @IsUrl()
  url: string;
}

export class ParkingLotImagesDto {
  @IsOptional()
  @IsString()
  @IsUrl()
  thumbnail?: string;

  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  gallery?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ParkingLotDocumentDto)
  documents?: ParkingLotDocumentDto[];
}

export class CreateRequestDto {
  @IsEnum(RequestType)
  type: RequestType;

  @IsObject()
  @IsNotEmpty()
  payload: Record<string, any>;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ParkingLotImagesDto)
  images?: ParkingLotImagesDto;

  @IsUUID()
  requesterId: string;
}
