import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { RequestType } from '../entities/request.entity';

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

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  note?: string;

  @IsUUID()
  requesterId: string;
}
