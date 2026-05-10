import { IsNumber } from 'class-validator';

export class CreatePricingRuleDto {
  @IsNumber()
  price_per_hour: number;

  @IsNumber()
  price_per_day: number;

  @IsNumber()
  parking_lot_id?: number;

  @IsNumber()
  parking_zone_id: number;

  @IsNumber()
  parking_floor_id?: number;
}
