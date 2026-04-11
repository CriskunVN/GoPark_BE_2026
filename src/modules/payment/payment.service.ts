import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PricingRule } from './entities/pricingrule.entity';
import { CreatePricingRuleDto } from './dto/create-pricing-rule.dto';
import { UpdatePricingRuleDto } from './dto/update-pricing-rule.dto';
import { Payment } from './entities/payment.entity';
import { Transaction } from './entities/transaction.entity';
import { BookingStatus, PaymentStatus, SlotStatus, TransactionStatus } from 'src/common/enums/status.enum';
import { BookingService } from '../booking/booking.service';
import { Booking } from '../booking/entities/booking.entity';
import { DataSource } from 'typeorm';
import { ParkingSlot } from '../parking-lot/entities/parking-slot.entity';


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
    @InjectRepository (Booking)
    private readonly bookingRepository: Repository<Booking>,
    private dataSource:DataSource
  ) {}

  async handleBookingVnpayPayment(bookingId: number, amount: number, transactionRef: string) {
    // Tạo một queryRunner để quản lý transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Lấy thông tin booking (phải dùng manager của queryRunner)
      const booking = await queryRunner.manager.findOne(Booking, {
        where: { id: bookingId },
        relations: ['slot']
      });

      // 2. Cập nhật trạng thái Booking
      await queryRunner.manager.update(Booking, bookingId, { status: BookingStatus.CONFIRMED });

      // 3. Cập nhật trạng thái Slot
      if (booking?.slot) {
        await queryRunner.manager.update(ParkingSlot, booking.slot.id, {
          status: SlotStatus.OCCUPIED 
        });
      }

      // 4. Lưu Payment & Transaction
      const payment = queryRunner.manager.create(Payment, { amount, method: 'VNPAY', status: PaymentStatus.PAID });
      const savedPayment = await queryRunner.manager.save(payment);

      const transaction = queryRunner.manager.create(Transaction, {
        gateway_txn_id: transactionRef,
        amount,
        payment: savedPayment,
        status:TransactionStatus.SUCCESS
      });
      await queryRunner.manager.save(transaction);

      // NẾU ĐẾN ĐÂY KHÔNG CÓ LỖI -> LƯU TẤT CẢ
      await queryRunner.commitTransaction();
      
      // Gửi email có thể để ngoài transaction vì nó không ảnh hưởng DB
      this.bookingService.sendEmail(bookingId);

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

  async createPricingRule(dto: CreatePricingRuleDto) {
    const newRule = this.pricingRuleRepository.create({
      price_per_hour: dto.price_per_hour,
      price_per_day: dto.price_per_day,
      parkingLot: dto.parking_lot_id ? { id: dto.parking_lot_id } : undefined,
      parkingFloor: { id: dto.parking_floor_id },
      parkingZone: { id: dto.parking_zone_id },
    });

    return await this.pricingRuleRepository.save(newRule);
  }

  async getPricingRuleByZone(zoneId: number) {
    return await this.pricingRuleRepository.find({
      where: { parkingZone: { id: zoneId } },
      relations: ['parkingZone', 'parkingLot'],
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
        parkingLot: { id: lotId },
        parkingFloor: { id: floorId },
        parkingZone: { id: zoneId },
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
