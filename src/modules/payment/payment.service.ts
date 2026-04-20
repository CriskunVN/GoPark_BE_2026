import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PricingRule } from './entities/pricingrule.entity';
import { CreatePricingRuleDto } from './dto/create-pricing-rule.dto';
import { UpdatePricingRuleDto } from './dto/update-pricing-rule.dto';
import { Payment } from './entities/payment.entity';
import { Invoice } from './entities/invoice.entity';
import { Transaction } from './entities/transaction.entity';
import {
  BookingStatus,
  PaymentStatus,
  SlotStatus,
  TransactionStatus,
  InvoiceStatus,
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
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
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
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Lấy thông tin booking
      const booking = await queryRunner.manager.findOne(Booking, {
        where: { id: bookingId },
        relations: ['slot'],
      });

      if (!booking) throw new NotFoundException('Booking not found');

      // 2. TẠO INVOICE TRƯỚC (Để lấy ID gán cho Payment)
      // Tên file pdf tạm thời dùng timestamp
      const tempFileName = `inv-${bookingId}-${Date.now()}.pdf`;
      const invoiceFileUrl = `/invoices/${bookingId}/${tempFileName}`;

      const invoice = queryRunner.manager.create(Invoice, {
        total: amount,
        tax: 0,
        status: InvoiceStatus.PAID,
        file_url: invoiceFileUrl,
        booking: { id: bookingId },
      });
      const savedInvoice = await queryRunner.manager.save(invoice);

      // 3. TẠO PAYMENT (Gán luôn invoice vừa tạo vào đây)
      const payment = queryRunner.manager.create(Payment, {
        amount,
        method: 'VNPAY',
        status: PaymentStatus.PAID, // VNPAY trả về success nên để PAID luôn
        invoice: savedInvoice, // QUAN TRỌNG: Gán quan hệ ở đây để DB có invoice_id
      });
      const savedPayment = await queryRunner.manager.save(payment);

      // 4. LƯU TRANSACTION (Liên kết với Payment vừa tạo)
      const transaction = queryRunner.manager.create(Transaction, {
        gateway_txn_id: transactionRef,
        amount,
        payment: savedPayment,
        status: TransactionStatus.SUCCESS,
      });
      await queryRunner.manager.save(transaction);

      // 5. Cập nhật trạng thái Booking và Slot
      await queryRunner.manager.update(Booking, bookingId, {
        status: BookingStatus.CONFIRMED,
      });

      if (booking?.slot) {
        await queryRunner.manager.update(ParkingSlot, booking.slot.id, {
          status: SlotStatus.OCCUPIED,
        });
      }

      // 6. Hoàn tất giao dịch
      await queryRunner.commitTransaction();

      // Gửi email
      this.bookingService
        .sendEmail(bookingId)
        .catch((err) => console.error('Email error:', err));

      return savedPayment;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      console.error('TRANSACTION ERROR:', err);
      throw err;
    } finally {
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

  async getInvoiceByBooking(bookingId: number) {
    const numericId = Number(bookingId);
    // Fetch invoice directly to avoid joining payments (DB may not have invoice_id column yet)
    const invoice = await this.invoiceRepository.findOne({
      where: { booking: { id: numericId } },
      relations: [
        'booking',
        'booking.slot',
        'booking.slot.parkingZone',
        'booking.slot.parkingZone.parkingFloor',
        'booking.slot.parkingZone.parkingFloor.parkingLot',
        'booking.user',
        'booking.user.profile',
      ],
    });

    if (!invoice) {
      console.log(`Không tìm thấy Invoice cho Booking ID: ${numericId}`);
      throw new NotFoundException(
        `Không tìm thấy hóa đơn cho mã đặt chỗ ${numericId}`,
      );
    }

    return invoice;
  }
}
