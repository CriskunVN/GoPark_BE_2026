import { IsEnum } from 'class-validator';
import { VoucherStatus } from 'src/common/enums/voucher.enum';

export class UpdateVoucherStatusDto {
  @IsEnum(VoucherStatus)
  status: VoucherStatus;
}
