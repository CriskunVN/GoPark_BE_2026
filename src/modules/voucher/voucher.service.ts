import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Not, Repository } from 'typeorm';
import { Voucher } from './entities/voucher.entity';
import { UserVoucherUsage } from './entities/user-voucher-usage.entity';
import { Booking } from '../booking/entities/booking.entity';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { UpdateVoucherDto } from './dto/update-voucher.dto';
import { CalculateVoucherDto } from './dto/calculate-voucher.dto';
import {
  VoucherDiscountType,
  VoucherStatus,
} from 'src/common/enums/voucher.enum';
import { BookingStatus } from 'src/common/enums/status.enum';

@Injectable()
export class VoucherService {
  constructor(
    @InjectRepository(Voucher)
    private voucherRepository: Repository<Voucher>,
    @InjectRepository(UserVoucherUsage)
    private usageRepository: Repository<UserVoucherUsage>,
    @InjectRepository(Booking)
    private bookingRepository: Repository<Booking>,
  ) {}

  // ========= Hàm này sẽ chuẩn hóa mã giảm giá bằng cách loại bỏ khoảng trắng
  // và chuyển thành chữ hoa để đảm bảo tính nhất quán khi lưu trữ và so sánh ==========
  normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  // ========= Hàm này sẽ đảm bảo rằng thời gian bắt đầu nhỏ hơn thời gian kết thúc ==========
  private ensureDateRange(start: Date, end: Date) {
    if (start >= end) {
      throw new BadRequestException(
        'Thoi gian bat dau phai nho hon thoi gian ket thuc',
      );
    }
  }

  // ========= Hàm này sẽ đảm bảo rằng giá trị giảm phù hợp với loại giảm giá
  // (phần trăm phải trong 1-100, số tiền cố định phải lớn hơn 0) ==========
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

  // ======== Hàm này sẽ đảm bảo rằng các điều kiện liên quan đến số lần booking của người dùng không mâu thuẫn với nhau
  // và có logic hợp lý (ví dụ: không thể vừa yêu cầu là booking lần đầu vừa yêu cầu số lần booking tối thiểu) ========
  private ensureBookingConditionRules(
    firstBookingOnly: boolean,
    minBookingCount?: number | null,
  ) {
    if (firstBookingOnly && (minBookingCount ?? 0) > 0) {
      throw new BadRequestException(
        'Khong the vua yeu cau booking lan dau vua dat so lan booking toi thieu',
      );
    }
  }

  // ========= Hàm lấy số lần booking đã hoàn thành của người dùng,
  //  được sử dụng để kiểm tra điều kiện áp dụng voucher dựa trên số lần booking của người dùng ==========
  private async getUserBookingCount(userId: string, manager?: EntityManager) {
    const repo = manager
      ? manager.getRepository(Booking)
      : this.bookingRepository;

    return repo.count({
      where: {
        user: { id: userId },
        status: BookingStatus.COMPLETED,
      },
    });
  }

  // ======== Hàm này sẽ kiểm tra xem voucher có áp dụng được cho người dùng hay không
  // dựa trên điều kiện về số lần booking đã có của người dùng và các điều kiện khác của voucher ========
  private isVoucherEligibleForBookingCount(
    voucher: Voucher,
    bookingCount: number,
  ): boolean {
    if (voucher.first_booking_only) {
      return bookingCount === 0;
    }

    if (
      voucher.min_booking_count !== null &&
      voucher.min_booking_count !== undefined
    ) {
      return bookingCount >= Number(voucher.min_booking_count);
    }

    return true;
  }

  // ========= Hàm này sẽ kiểm tra xem voucher có áp dụng được cho người dùng hay không dựa trên
  // điều kiện về số lần booking đã có của người dùng và các điều kiện khác của voucher ==========
  private ensureVoucherEligibleForUser(voucher: Voucher, bookingCount: number) {
    if (voucher.first_booking_only && bookingCount > 0) {
      throw new BadRequestException('Voucher chi ap dung cho booking lan dau');
    }

    if (
      voucher.min_booking_count !== null &&
      voucher.min_booking_count !== undefined &&
      bookingCount < Number(voucher.min_booking_count)
    ) {
      throw new BadRequestException(
        `Can it nhat ${voucher.min_booking_count} lan dat cho de su dung voucher`,
      );
    }
  }

  // ========= Hàm này sẽ kiểm tra xem voucher có thể sử dụng được không dựa trên trạng thái,
  // thời gian, số lượt đã dùng và giá trị đơn hàng ==========
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

  // ========= Hàm này sẽ tính toán số tiền được giảm dựa trên loại và giá trị giảm của voucher, cũng như áp dụng giới hạn tối đa nếu có ==========
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

    const firstBookingOnly = dto.first_booking_only ?? false;
    const minBookingCount = dto.min_booking_count ?? null;
    this.ensureBookingConditionRules(firstBookingOnly, minBookingCount);

    const voucher = this.voucherRepository.create({
      code,
      discount_type: dto.discount_type,
      discount_value: dto.discount_value,
      max_discount_amount: dto.max_discount_amount ?? null,
      min_booking_value: dto.min_booking_value ?? 0,
      usage_limit: dto.usage_limit,
      used_count: 0,
      min_booking_count: minBookingCount,
      first_booking_only: firstBookingOnly,
      start_time: startTime,
      end_time: endTime,
      status: dto.status ?? VoucherStatus.ACTIVE,
    });

    return this.voucherRepository.save(voucher);
  }

  // ========= Hàm này sẽ lấy danh sách mã giảm giá với phân trang và lọc theo trạng thái (nếu có) để hiển thị cho admin ==========
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

    const nextMinBookingCount =
      dto.min_booking_count !== undefined
        ? dto.min_booking_count
        : voucher.min_booking_count;
    const nextFirstBookingOnly =
      dto.first_booking_only !== undefined
        ? dto.first_booking_only
        : voucher.first_booking_only;
    this.ensureBookingConditionRules(nextFirstBookingOnly, nextMinBookingCount);

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
    if (dto.min_booking_count !== undefined) {
      voucher.min_booking_count = dto.min_booking_count;
    }
    if (dto.first_booking_only !== undefined) {
      voucher.first_booking_only = dto.first_booking_only;
    }

    return this.voucherRepository.save(voucher);
  }

  // ========= Hàm này sẽ cập nhật trạng thái của voucher,
  //  thường được sử dụng để kích hoạt hoặc hủy kích hoạt voucher ==========
  async updateVoucherStatus(id: string, status: VoucherStatus) {
    const voucher = await this.voucherRepository.findOne({ where: { id } });
    if (!voucher) {
      throw new NotFoundException('Khong tim thay ma giam gia');
    }

    voucher.status = status;
    return this.voucherRepository.save(voucher);
  }

  // ========= Hàm này sẽ lấy danh sách mã giảm giá đang hoạt động và có thể sử dụng được cho người dùng,
  //  thường được gọi khi người dùng muốn xem các mã giảm giá có sẵn để áp dụng cho đơn hàng của họ ==========
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

  async getEligibleVouchers(userId: string) {
    const bookingCount = await this.getUserBookingCount(userId);
    const vouchers = await this.getActiveVouchers();

    return vouchers.filter((voucher) =>
      this.isVoucherEligibleForBookingCount(voucher, bookingCount),
    );
  }

  async getAllVouchersWithEligibility(userId: string) {
    const bookingCount = await this.getUserBookingCount(userId);
    const now = new Date();

    // Lấy tất cả voucher đang trong thời gian hiệu lực và đang ACTIVE (bao gồm cả cái đã hết lượt dùng)
    const vouchers = await this.voucherRepository
      .createQueryBuilder('voucher')
      .where('voucher.status = :status', { status: VoucherStatus.ACTIVE })
      .andWhere('voucher.start_time <= :now', { now })
      .andWhere('voucher.end_time >= :now', { now })
      .orderBy('voucher.createdAt', 'DESC')
      .getMany();

    // Lấy danh sách các voucher mà người dùng đã sử dụng (chỉ tính các booking đã CONFIRMED, ONGOING hoặc COMPLETED)
    // Voucher đang ở trạng thái PENDING thì vẫn coi là chưa dùng xong để người dùng có thể chọn lại nếu muốn
    const usedUsages = await this.usageRepository.find({
      where: {
        user_id: userId,
        booking: { status: Not(BookingStatus.PENDING) },
      },
      relations: ['booking'],
      select: ['voucher_id'],
    });
    const usedVoucherIds = usedUsages.map((u) => u.voucher_id);

    return vouchers
      .map((voucher) => {
        const isUsed = usedVoucherIds.includes(voucher.id);
        const isExhausted = Number(voucher.used_count) >= Number(voucher.usage_limit);
        const isBookingCountEligible = this.isVoucherEligibleForBookingCount(
          voucher,
          bookingCount,
        );

        const isEligible = isBookingCountEligible && !isUsed && !isExhausted;

        let ineligibleReason: string | null = null;
        if (isUsed) {
          ineligibleReason = 'Bạn đã sử dụng voucher này rồi';
        } else if (isExhausted) {
          ineligibleReason = 'Voucher đã hết lượt sử dụng';
        } else if (!isBookingCountEligible) {
          if (voucher.first_booking_only) {
            ineligibleReason = 'Chỉ dành cho lượt đặt chỗ đầu tiên';
          } else if (
            voucher.min_booking_count !== null &&
            voucher.min_booking_count > bookingCount
          ) {
            ineligibleReason = `Cần ít nhất ${voucher.min_booking_count} lượt đặt chỗ để sử dụng`;
          }
        }

        return {
          ...voucher,
          is_user_eligible: isEligible,
          ineligible_reason: ineligibleReason,
          user_booking_count: bookingCount,
          is_exhausted: isExhausted,
          is_used: isUsed,
        };
      })
      .filter((v) => !v.is_used); // Lọc bỏ những voucher người dùng đã sử dụng
  }

  // ========= Hàm này sẽ tính toán tổng tiền sau khi áp dụng mã giảm giá,
  //  đồng thời kiểm tra tính hợp lệ của mã và đảm bảo rằng nó có thể được sử dụng cho đơn hàng hiện tại ==========
  async calculateVoucher(dto: CalculateVoucherDto) {
    // để đảm bảo tính nhất quán khi so sánh mã giảm giá,
    //  chúng ta sẽ chuẩn hóa mã trước khi tìm kiếm trong cơ sở dữ liệu
    const code = this.normalizeCode(dto.code);

    const voucher = await this.voucherRepository.findOne({ where: { code } });

    if (!voucher) {
      throw new NotFoundException('Khong tim thay ma giam gia');
    }

    // để đảm bảo rằng mã giảm giá có thể được sử dụng cho đơn hàng này,
    // sẽ kiểm tra các điều kiện như trạng thái, thời gian, số lượt đã dùng và giá trị đơn hàng
    this.ensureVoucherUsable(voucher, dto.sub_total);

    // nếu mã giảm giá hợp lệ, sẽ tính toán số tiền được giảm dựa trên loại và giá trị giảm của voucher,
    const discountAmount = this.calculateDiscount(voucher, dto.sub_total);
    const total = Math.max(0, dto.sub_total - discountAmount);

    return {
      code: voucher.code,
      sub_total: dto.sub_total,
      discount_amount: discountAmount,
      total,
    };
  }

  // ========= Hàm này sẽ thực hiện việc kiểm tra tính hợp lệ của voucher
  // và khóa nó để tránh tình trạng race condition khi nhiều người dùng cùng sử dụng một mã giảm giá ==========
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

    const bookingCount = await this.getUserBookingCount(userId, manager);
    this.ensureVoucherEligibleForUser(voucher, bookingCount);

    const usage = await usageRepo.findOne({
      where: { user_id: userId, voucher_id: voucher.id },
    });

    if (usage) {
      throw new BadRequestException('Ban da su dung ma giam gia nay');
    }

    const discountAmount = this.calculateDiscount(voucher, subTotal);

    return { voucher, discountAmount };
  }

  // ========= Hàm này sẽ ghi nhận việc sử dụng voucher sau khi đã được xác thực và khóa,
  //  đảm bảo tính nhất quán của dữ liệu và cập nhật số lượt đã dùng của voucher ==========
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

  // ========= Hàm này sẽ thực hiện việc hoàn tác việc sử dụng voucher trong trường hợp booking bị hủy hoặc có lỗi,
  // đảm bảo rằng số lượt đã dùng của voucher được cập nhật chính xác và người dùng có thể sử dụng lại voucher nếu cần ==========
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
