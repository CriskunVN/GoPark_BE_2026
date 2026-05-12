import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  UseGuards,
  Query,
} from '@nestjs/common';
import { WalletService } from './wallet.service';
import { UpdateBalanceDto, PaymentDto } from './dto/wallet.dto';

@Controller('wallets')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Post('init')
  async initTestWallet(@Body('userId') userId: string) {
    return await this.walletService.createWallet(userId);
  }

  @Post('deposit')
  async deposit(
    @Req() req: any,
    @Body() dto: UpdateBalanceDto & { userId?: string },
  ) {
    const userId =
      dto.userId || req.user?.id || '123e4567-e89b-12d3-a456-426614174000';
    return await this.walletService.deposit(userId, dto.amount, dto.refId);
  }

  @Post('withdraw')
  async withdraw(
    @Req() req: any,
    @Body() dto: UpdateBalanceDto & { userId?: string },
  ) {
    const userId =
      dto.userId || req.user?.id || '123e4567-e89b-12d3-a456-426614174000';
    return await this.walletService.withdraw(userId, dto.amount, dto.refId);
  }

  @Post('payment')
  async payment(
    @Req() req: any,
    @Body() dto: PaymentDto & { customerId?: string },
  ) {
    const customerId =
      dto.customerId || req.user?.id || '123e4567-e89b-12d3-a456-426614174000';
    await this.walletService.processPayment(
      customerId,
      dto.ownerId,
      dto.amount,
      dto.bookingId,
    );
    return { success: true, message: 'Thanh toan phi do xe thanh cong' };
  }

  @Get('transactions')
  async getMyTransactions(@Req() req: any) {
    const userId =
      req.query.userId ||
      req.user?.id ||
      '123e4567-e89b-12d3-a456-426614174000';
    return await this.walletService.getTransactions(userId);
  }

  @Get('my-wallet')
  async getMyWallet(@Req() req: any) {
    const userId =
      req.query.userId ||
      req.user?.id ||
      '123e4567-e89b-12d3-a456-426614174000';
    return await this.walletService.getWalletByUserId(userId);
  }

  // ============== ADMIN: GIAO DỊCH RÚT TIỀN ==============

  @Get('withdraw-requests')
  async getWithdrawRequests() {
    return await this.walletService.getWithdrawRequests();
  }

  @Post('withdraw-requests/:id/approve')
  async approveWithdrawRequest(@Req() req: any) {
    return await this.walletService.approveWithdrawRequest(req.params.id);
  }

  @Post('withdraw-requests/:id/reject')
  async rejectWithdrawRequest(@Req() req: any) {
    return await this.walletService.rejectWithdrawRequest(req.params.id);
  }

  @Get('transaction/:id')
  async getTransactionDetails(@Req() req: any) {
    return await this.walletService.getTransactionById(req.params.id);
  }

  @Post('withdraw-requests/:id/complaint')
  async complainWithdrawRequest(
    @Req() req: any,
    @Body() body: { userId?: string; message?: string },
  ) {
    const userId =
      body.userId || req.user?.id || '123e4567-e89b-12d3-a456-426614174000';
    return await this.walletService.complainWithdrawRequest(
      req.params.id,
      userId,
      body.message,
    );
  }
}
