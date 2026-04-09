import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PricingRule } from './entities/pricingrule.entity';
import { CreatePricingRuleDto } from './dto/create-pricing-rule.dto';
import { UpdatePricingRuleDto } from './dto/update-pricing-rule.dto';

@Injectable()
export class PaymentService {
  constructor(
    @InjectRepository(PricingRule)
    private readonly pricingRuleRepository: Repository<PricingRule>,
  ) {}

  async createPricingRule(dto: CreatePricingRuleDto) {
    const newRule = this.pricingRuleRepository.create({
      price_per_hour: dto.price_per_hour,
      price_per_day: dto.price_per_day,
      parkingZone: { id: dto.parking_zone_id },
    });

    return await this.pricingRuleRepository.save(newRule);
  }

  async getPricingRuleByZone(zoneId: number) {
    return await this.pricingRuleRepository.find({
      where: { parkingZone: { id: zoneId } },
      relations: ['parkingZone'],
    });
  }

  async updatePricingRule(
    lotId: number,
    floorId: number,
    zoneId: number,
    id: number,
    dto: UpdatePricingRuleDto,
  ) {
    const rule = await this.pricingRuleRepository.findOne({
      where: {
        id,
        parkingZone: {
          id: zoneId,
          parkingFloor: {
            id: floorId,
            parkingLot: { id: lotId },
          },
        },
      },
    });
    if (!rule) {
      throw new NotFoundException(
        'Pricing rule not found or mismatched with hierarchy',
      );
    }

    Object.assign(rule, dto);
    return await this.pricingRuleRepository.save(rule);
  }
}
