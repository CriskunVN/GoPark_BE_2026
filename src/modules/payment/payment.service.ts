import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PricingRule } from './entities/pricingrule.entity';
import { CreatePricingRuleDto } from './dto/create-pricing-rule.dto';
import { UpdatePricingRuleDto } from './dto/update-pricing-rule.dto';
import { Payment } from './entities/payment.entity';
import { Transaction } from './entities/transaction.entity';
import {
  BookingStatus,
  PaymentStatus,
  SlotStatus,
  TransactionStatus,
} from 'src/common/enums/status.enum';
import { BookingService } from '../booking/booking.service';
import { Booking } from '../booking/entities/booking.entity';
import { DataSource } from 'typeorm';
import { ParkingSlot } from '../parking-lot/entities/parking-slot.entity';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class PaymentService {
  constructor(
    @InjectRepository(PricingRule)
    private readonly pricingRuleRepository: Repository<PricingRule>,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    private readonly bookingService: BookingService,
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    private dataSource: DataSource,
    private readonly walletService: WalletService,
  ) {}

  async handleBookingVnpayPayment(
    bookingId: number,
    amount: number,
    transactionRef: string,
  ) {
    // Tạo một queryRunner để quản lý transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Lấy thông tin booking (phải dùng manager của queryRunner)
      const booking = await queryRunner.manager.findOne(Booking, {
        where: { id: bookingId },
        relations: ['slot'],
      });

      // 2. Cập nhật trạng thái Booking
      await queryRunner.manager.update(Booking, bookingId, {
        status: BookingStatus.CONFIRMED,
      });

      // 3. Cập nhật trạng thái Slot
      if (booking?.slot) {
        await queryRunner.manager.update(ParkingSlot, booking.slot.id, {
          status: SlotStatus.OCCUPIED,
        });
      }

      // 4. Lưu Payment & Transaction
      const payment = queryRunner.manager.create(Payment, {
        amount,
        method: 'VNPAY',
        status: PaymentStatus.PAID,
      });
      const savedPayment = await queryRunner.manager.save(payment);

      const transaction = queryRunner.manager.create(Transaction, {
        gateway_txn_id: transactionRef,
        amount,
        payment: savedPayment,
        status: TransactionStatus.SUCCESS,
      });
      await queryRunner.manager.save(transaction);

      // NẾU ĐẾN ĐÂY KHÔNG CÓ LỖI -> LƯU TẤT CẢ
      await queryRunner.commitTransaction();

      // --- Các tác vụ sau commit (không ảnh hưởng DB chính nếu lỗi) ---

      // Gửi email xác nhận cho khách hàng
      this.bookingService
        .sendEmail(bookingId)
        .catch((err) => console.error('[Payment] Lỗi gửi email:', err));

      // Cộng tiền vào ví Owner của bãi đỗ xe
      this.creditOwnerWallet(bookingId, amount, transactionRef).catch((err) =>
        console.error('[Payment] Lỗi cộng tiền ví owner:', err),
      );

      return savedPayment;
    } catch (err) {
      // NẾU CÓ BẤT KỲ LỖI NÀO -> HỦY HẾT, DB KHÔNG THAY ĐỔI GÌ
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      // Giải phóng kết nối
      await queryRunner.release();
    }
  }

  /**
   * Tìm ownerId qua chuỗi quan hệ: Booking → Slot → Zone → Floor → Lot → Owner
   * Sau đó nạp tiền vào ví của Owner.
   * Hàm này được gọi BẤT ĐỒNG BỘ sau khi commit transaction thanh toán,
   * nên dù có lỗi cũng KHÔNG ảnh hưởng đến trạng thái Booking/Slot của user.
   */
  private async creditOwnerWallet(
    bookingId: number,
    amount: number,
    transactionRef: string,
  ): Promise<void> {
    // Load đầy đủ chuỗi quan hệ để lấy thông tin Owner
    const booking = await this.bookingRepository.findOne({
      where: { id: bookingId },
      relations: [
        'slot',
        'slot.parkingZone',
        'slot.parkingZone.parkingFloor',
        'slot.parkingZone.parkingFloor.parkingLot',
        'slot.parkingZone.parkingFloor.parkingLot.owner',
      ],
    });

    if (!booking) {
      console.error(`[CreditOwner] Không tìm thấy booking #${bookingId}`);
      return;
    }

    const owner = booking?.slot?.parkingZone?.parkingFloor?.parkingLot?.owner;

    if (!owner?.id) {
      console.error(
        `[CreditOwner] Không xác định được Owner từ booking #${bookingId}`,
      );
      return;
    }

    const parkingLotName =
      booking?.slot?.parkingZone?.parkingFloor?.parkingLot?.name ?? 'bãi xe';

    console.log(
      `[CreditOwner] Cộng ${amount.toLocaleString('vi-VN')}đ vào ví owner ${owner.id} (${parkingLotName}) - booking #${bookingId}`,
    );

    await this.walletService.deposit(
      owner.id,
      amount,
      `BOOKING_${bookingId}_VNPAY_${transactionRef}`,
    );
  }

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
