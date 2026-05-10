import { IsNumber, IsPositive, IsString, IsNotEmpty } from 'class-validator';

export class UpdateBalanceDto {
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsString()
  @IsNotEmpty()
  refId: string;
}

export class PaymentDto {
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsString()
  @IsNotEmpty()
  ownerId: string;

  @IsString()
  @IsNotEmpty()
  bookingId: string;
}
