import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { VoucherService } from './voucher.service';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { UpdateVoucherDto } from './dto/update-voucher.dto';
import { UpdateVoucherStatusDto } from './dto/update-voucher-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRoleEnum } from 'src/common/enums/role.enum';
import { VoucherStatus } from 'src/common/enums/voucher.enum';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRoleEnum.ADMIN)
@Controller('admin/vouchers')
export class AdminVoucherController {
  constructor(private readonly voucherService: VoucherService) {}

  @Post()
  create(@Body() dto: CreateVoucherDto) {
    return this.voucherService.createVoucher(dto);
  }

  @Get()
  getAll(
    @Query('page') page = '1',
    @Query('limit') limit = '5',
    @Query('status') status?: string,
  ) {
    let statusFilter: VoucherStatus | undefined;
    if (status) {
      if (!Object.values(VoucherStatus).includes(status as VoucherStatus)) {
        throw new BadRequestException('Trang thai voucher khong hop le');
      }
      statusFilter = status as VoucherStatus;
    }

    return this.voucherService.getAdminVouchers(
      Number(page),
      Number(limit),
      statusFilter,
    );
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateVoucherDto) {
    return this.voucherService.updateVoucher(id, dto);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateVoucherStatusDto) {
    return this.voucherService.updateVoucherStatus(id, dto.status);
  }
}
