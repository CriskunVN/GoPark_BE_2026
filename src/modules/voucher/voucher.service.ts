import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Voucher } from './entities/voucher.entity';
import { UserVoucherUsage } from './entities/user-voucher-usage.entity';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { UpdateVoucherDto } from './dto/update-voucher.dto';
import { CalculateVoucherDto } from './dto/calculate-voucher.dto';
import {
  VoucherDiscountType,
  VoucherStatus,
} from 'src/common/enums/voucher.enum';

@Injectable()
export class VoucherService {
  constructor(
    @InjectRepository(Voucher)
    private voucherRepository: Repository<Voucher>,
    @InjectRepository(UserVoucherUsage)
    private usageRepository: Repository<UserVoucherUsage>,
  ) {}

  normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  private ensureDateRange(start: Date, end: Date) {
    if (start >= end) {
      throw new BadRequestException(
        'Thoi gian bat dau phai nho hon thoi gian ket thuc',
      );
    }
  }

  private ensureDiscountRules(
    discountType: VoucherDiscountType,
    discountValue: number,
  ) {
    if (
      discountType === VoucherDiscountType.PERCENTAGE &&
      (discountValue <= 0 || discountValue > 100)
    ) {
      throw new BadRequestException('Giam phan tram phai trong khoang 1-100');
    }

    if (
      discountType === VoucherDiscountType.FIXED_AMOUNT &&
      discountValue <= 0
    ) {
      throw new BadRequestException('Gia tri giam phai lon hon 0');
    }
  }

  private ensureVoucherUsable(voucher: Voucher, subTotal: number) {
    const now = new Date();

    if (voucher.status !== VoucherStatus.ACTIVE) {
      throw new BadRequestException('Ma giam gia khong hoat dong');
    }

    if (voucher.start_time > now || voucher.end_time < now) {
      throw new BadRequestException('Ma giam gia ngoai thoi han su dung');
    }

    if (voucher.used_count >= voucher.usage_limit) {
      throw new BadRequestException('Ma giam gia da het luot su dung');
    }

    if (subTotal < Number(voucher.min_booking_value || 0)) {
      throw new BadRequestException('Gia tri don hang chua dat muc toi thieu');
    }
  }

  private calculateDiscount(voucher: Voucher, subTotal: number): number {
    let discount = 0;

    if (voucher.discount_type === VoucherDiscountType.PERCENTAGE) {
      discount = (subTotal * Number(voucher.discount_value)) / 100;
    } else {
      discount = Number(voucher.discount_value);
    }

    if (
      voucher.max_discount_amount !== null &&
      voucher.max_discount_amount !== undefined
    ) {
      discount = Math.min(discount, Number(voucher.max_discount_amount));
    }

    discount = Math.max(0, Math.min(discount, subTotal));
    return Math.round(discount * 100) / 100;
  }

  async createVoucher(dto: CreateVoucherDto) {
    const code = this.normalizeCode(dto.code);

    const existing = await this.voucherRepository.findOne({ where: { code } });
    if (existing) {
      throw new BadRequestException('Ma giam gia da ton tai');
    }

    const startTime = new Date(dto.start_time);
    const endTime = new Date(dto.end_time);
    this.ensureDateRange(startTime, endTime);
    this.ensureDiscountRules(dto.discount_type, dto.discount_value);

    const voucher = this.voucherRepository.create({
      code,
      discount_type: dto.discount_type,
      discount_value: dto.discount_value,
      max_discount_amount: dto.max_discount_amount ?? null,
      min_booking_value: dto.min_booking_value ?? 0,
      usage_limit: dto.usage_limit,
      used_count: 0,
      start_time: startTime,
      end_time: endTime,
      status: dto.status ?? VoucherStatus.ACTIVE,
    });

    return this.voucherRepository.save(voucher);
  }

  async getAdminVouchers(page = 1, limit = 10, status?: VoucherStatus) {
    const currentPage = Math.max(1, Number(page) || 1);
    const itemsPerPage = Math.min(100, Math.max(1, Number(limit) || 10));

    const query = this.voucherRepository.createQueryBuilder('voucher');

    if (status) {
      query.andWhere('voucher.status = :status', { status });
    }

    const [items, totalItems] = await query
      .orderBy('voucher.createdAt', 'DESC')
      .skip((currentPage - 1) * itemsPerPage)
      .take(itemsPerPage)
      .getManyAndCount();

    return {
      items,
      meta: {
        totalItems,
        itemCount: items.length,
        itemsPerPage,
        totalPages: Math.ceil(totalItems / itemsPerPage) || 1,
        currentPage,
      },
    };
  }

  async updateVoucher(id: string, dto: UpdateVoucherDto) {
    const voucher = await this.voucherRepository.findOne({ where: { id } });
    if (!voucher) {
      throw new NotFoundException('Khong tim thay ma giam gia');
    }

    if (
      voucher.used_count > 0 &&
      (dto.discount_type !== undefined || dto.discount_value !== undefined)
    ) {
      throw new BadRequestException(
        'Khong duoc thay doi loai giam gia hoac gia tri khi da co nguoi su dung',
      );
    }

    if (dto.code) {
      const normalized = this.normalizeCode(dto.code);
      const existing = await this.voucherRepository.findOne({
        where: { code: normalized },
      });
      if (existing && existing.id !== voucher.id) {
        throw new BadRequestException('Ma giam gia da ton tai');
      }
      voucher.code = normalized;
    }

    const nextDiscountType = dto.discount_type ?? voucher.discount_type;
    const nextDiscountValue =
      dto.discount_value ?? Number(voucher.discount_value);
    this.ensureDiscountRules(nextDiscountType, nextDiscountValue);

    if (dto.start_time || dto.end_time) {
      const startTime = dto.start_time
        ? new Date(dto.start_time)
        : new Date(voucher.start_time);
      const endTime = dto.end_time
        ? new Date(dto.end_time)
        : new Date(voucher.end_time);
      this.ensureDateRange(startTime, endTime);
      voucher.start_time = startTime;
      voucher.end_time = endTime;
    }

    if (dto.discount_type !== undefined) {
      voucher.discount_type = dto.discount_type;
    }
    if (dto.discount_value !== undefined) {
      voucher.discount_value = dto.discount_value;
    }
    if (dto.max_discount_amount !== undefined) {
      voucher.max_discount_amount = dto.max_discount_amount;
    }
    if (dto.min_booking_value !== undefined) {
      voucher.min_booking_value = dto.min_booking_value;
    }
    if (dto.usage_limit !== undefined) {
      voucher.usage_limit = dto.usage_limit;
    }
    if (dto.status !== undefined) {
      voucher.status = dto.status;
    }

    return this.voucherRepository.save(voucher);
  }

  async updateVoucherStatus(id: string, status: VoucherStatus) {
    const voucher = await this.voucherRepository.findOne({ where: { id } });
    if (!voucher) {
      throw new NotFoundException('Khong tim thay ma giam gia');
    }

    voucher.status = status;
    return this.voucherRepository.save(voucher);
  }

  async getActiveVouchers() {
    const now = new Date();

    return this.voucherRepository
      .createQueryBuilder('voucher')
      .where('voucher.status = :status', { status: VoucherStatus.ACTIVE })
      .andWhere('voucher.start_time <= :now', { now })
      .andWhere('voucher.end_time >= :now', { now })
      .andWhere('voucher.used_count < voucher.usage_limit')
      .orderBy('voucher.createdAt', 'DESC')
      .getMany();
  }

  async calculateVoucher(dto: CalculateVoucherDto) {
    const code = this.normalizeCode(dto.code);
    const voucher = await this.voucherRepository.findOne({ where: { code } });

    if (!voucher) {
      throw new NotFoundException('Khong tim thay ma giam gia');
    }

    this.ensureVoucherUsable(voucher, dto.sub_total);

    const discountAmount = this.calculateDiscount(voucher, dto.sub_total);
    const total = Math.max(0, dto.sub_total - discountAmount);

    return {
      code: voucher.code,
      sub_total: dto.sub_total,
      discount_amount: discountAmount,
      total,
    };
  }

  async validateAndLockVoucher(
    code: string,
    userId: string,
    subTotal: number,
    manager: EntityManager,
  ): Promise<{ voucher: Voucher; discountAmount: number }> {
    const normalized = this.normalizeCode(code);
    const voucherRepo = manager.getRepository(Voucher);
    const usageRepo = manager.getRepository(UserVoucherUsage);

    const voucher = await voucherRepo
      .createQueryBuilder('voucher')
      .setLock('pessimistic_write')
      .where('voucher.code = :code', { code: normalized })
      .getOne();

    if (!voucher) {
      throw new NotFoundException('Khong tim thay ma giam gia');
    }

    this.ensureVoucherUsable(voucher, subTotal);

    const usage = await usageRepo.findOne({
      where: { user_id: userId, voucher_id: voucher.id },
    });

    if (usage) {
      throw new BadRequestException('Ban da su dung ma giam gia nay');
    }

    const discountAmount = this.calculateDiscount(voucher, subTotal);

    return { voucher, discountAmount };
  }

  async applyVoucherUsage(
    voucher: Voucher,
    bookingId: number,
    userId: string,
    manager: EntityManager,
  ) {
    const usageRepo = manager.getRepository(UserVoucherUsage);
    const voucherRepo = manager.getRepository(Voucher);

    const usage = usageRepo.create({
      user_id: userId,
      voucher_id: voucher.id,
      booking_id: bookingId,
    });

    await usageRepo.save(usage);
    voucher.used_count = Number(voucher.used_count) + 1;
    await voucherRepo.save(voucher);
  }

  async rollbackUsageForBooking(
    bookingId: number,
    manager?: EntityManager,
  ): Promise<boolean> {
    const usageRepo = manager
      ? manager.getRepository(UserVoucherUsage)
      : this.usageRepository;
    const voucherRepo = manager
      ? manager.getRepository(Voucher)
      : this.voucherRepository;

    const usage = await usageRepo.findOne({ where: { booking_id: bookingId } });
    if (!usage) {
      return false;
    }

    const voucher = await voucherRepo.findOne({
      where: { id: usage.voucher_id },
    });

    if (voucher) {
      voucher.used_count = Math.max(0, Number(voucher.used_count) - 1);
      await voucherRepo.save(voucher);
    }

    await usageRepo.delete(usage.id);
    return true;
  }
}
