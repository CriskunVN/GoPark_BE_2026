import { Body, Controller, Get, Post } from '@nestjs/common';
import { VoucherService } from './voucher.service';
import { CalculateVoucherDto } from './dto/calculate-voucher.dto';

@Controller('vouchers')
export class VoucherController {
  constructor(private readonly voucherService: VoucherService) {}

  @Get()
  getActiveVouchers() {
    return this.voucherService.getActiveVouchers();
  }

  @Post('calculate')
  calculate(@Body() dto: CalculateVoucherDto) {
    return this.voucherService.calculateVoucher(dto);
  }
}
