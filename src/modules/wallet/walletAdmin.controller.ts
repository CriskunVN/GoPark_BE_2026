import { Controller, Get, Query } from '@nestjs/common';
import { WalletService } from './wallet.service';

@Controller('admin/wallets')
export class WalletAdminController {
  constructor(private readonly walletService: WalletService) {}

  @Get('')
  async getAllTransactions(
    @Query('page') page = '1',
    @Query('limit') limit = '5',
    @Query('search') search?: string,
  ) {
    return await this.walletService.getAllTransactions(
      Number(page),
      Number(limit),
      search,
    );
  }
}
