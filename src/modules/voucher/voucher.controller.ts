import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { VoucherService } from './voucher.service';
import { CalculateVoucherDto } from './dto/calculate-voucher.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('vouchers')
export class VoucherController {
  constructor(private readonly voucherService: VoucherService) {}

  @Get()
  getActiveVouchers() {
    return this.voucherService.getActiveVouchers();
  }

  @UseGuards(JwtAuthGuard)
  @Get('eligible')
  getEligibleVouchers(@Req() req: any) {
    return this.voucherService.getEligibleVouchers(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('all-with-eligibility')
  getAllWithEligibility(@Req() req: any) {
    return this.voucherService.getAllVouchersWithEligibility(req.user.userId);
  }

  @Post('calculate')
  calculate(@Body() dto: CalculateVoucherDto) {
    return this.voucherService.calculateVoucher(dto);
  }
}
