import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  VoucherDiscountType,
  VoucherStatus,
} from 'src/common/enums/voucher.enum';

export class CreateVoucherDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsEnum(VoucherDiscountType)
  discount_type!: VoucherDiscountType;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discount_value!: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  max_discount_amount?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  min_booking_value?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  usage_limit!: number;

  @IsDateString()
  start_time!: string;

  @IsDateString()
  end_time!: string;

  @IsOptional()
  @IsEnum(VoucherStatus)
  status?: VoucherStatus;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  min_booking_count?: number;

  @IsOptional()
  @IsBoolean()
  first_booking_only?: boolean;
}
