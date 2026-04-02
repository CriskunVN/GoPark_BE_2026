import { IsNumber, IsOptional } from 'class-validator';

export class UpdatePricingRuleDto {
  @IsNumber()
  @IsOptional()
  price_per_hour?: number;

  @IsNumber()
  @IsOptional()
  price_per_day?: number;
}
