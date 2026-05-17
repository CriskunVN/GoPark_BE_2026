import {
  BadRequestException,
  Injectable,
  NotFoundException,
  forwardRef,
  Inject,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import dayjs from 'dayjs';
import { Between, In, Repository } from 'typeorm';

import { Booking } from './entities/booking.entity';
import { ParkingSlot } from '../parking-lot/entities/parking-slot.entity';
import { ParkingLot } from '../parking-lot/entities/parking-lot.entity';
import { QRCode } from './entities/qr-code.entity';
import { CheckLog } from './entities/check-log.entity';

import { CreateBookingDto } from './dto/create.dto';
import { EmailService } from '../auth/email/email.service';

import { randomUUID } from 'crypto';
import {
  ActivityStatus,
  BookingStatus,
  InvoiceStatus,
  SlotStatus,
} from 'src/common/enums/status.enum';
import { UserRoleEnum } from 'src/common/enums/role.enum';
import { ParkingLotService } from '../parking-lot/parking-lot.service';
import { ActivityService } from '../activity/activity.service';
import { ActivityType } from 'src/common/enums/type.enum';
import { Gate } from '../parking-lot/entities/gate.entity';
import { DataSource } from 'typeorm';
import { WalletService } from '../wallet/wallet.service';
import { Invoice } from '../payment/entities/invoice.entity';
import { PricingRule } from '../payment/entities/pricingrule.entity';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { VoucherService } from '../voucher/voucher.service';
import { VoucherCleanupService } from '../voucher/voucher-cleanup.service';

@Injectable()
export class BookingService {
  constructor(
    @InjectRepository(Booking)
    private bookingRepository: Repository<Booking>,

    @InjectRepository(ParkingSlot)
    private parkingSlotRepository: Repository<ParkingSlot>,

    @InjectRepository(QRCode)
    private qrcodeRepository: Repository<QRCode>,

    @InjectRepository(CheckLog)
    private checkLogRepository: Repository<CheckLog>,

    private readonly emailService: EmailService,
    private readonly activityService: ActivityService,
    private readonly usersService: UsersService,

    private dataSource: DataSource,

    @Inject(forwardRef(() => WalletService))
    private walletService: WalletService,

    @Inject(forwardRef(() => ParkingLotService))
    private readonly parkingLotService: ParkingLotService,

    private readonly voucherService: VoucherService,
    private readonly voucherCleanupService: VoucherCleanupService,
  ) {}

  // ================= CREATE BOOKING =================
  async createBooking(bookingdto: CreateBookingDto) {
    try {
      const subTotal = bookingdto.sub_total ?? 0;
      const voucherCode = bookingdto.voucher_code?.trim();

      // Gọi hàm dọn dẹp các booking pending đã hết hạn trước khi tạo mới để tránh xung đột dữ liệu và đảm bảo tính nhất quán của hệ thống
      await this.voucherCleanupService.cleanupExpiredPendingBookings();

      // Táº¡o transaction
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        //2. kiểm tra xe có đang bận ở vị trí khác không
        const startTime = new Date(bookingdto.start_time);
        const endTime = new Date(bookingdto.end_time);

        // 2a. Kiểm tra xe có đang đỗ (ONGOING) hoặc đã có lịch đặt chỗ chưa kết thúc (CONFIRMED/PENDING) không
        const ongoingBooking = await queryRunner.manager.findOne(Booking, {
          where: {
            vehicle: { id: bookingdto.vehicle_id },
            status: In([BookingStatus.ONGOING, BookingStatus.CONFIRMED]),
          },
        });

        if (ongoingBooking) {
          throw new BadRequestException(
            `Xe này hiện đã có một lịch đặt chỗ chưa hoàn thành (Trạng thái: ${ongoingBooking.status}). Vui lòng hoàn tất lượt đỗ cũ trước khi tạo lượt mới.`,
          );
        }

        const conflictingVehicle = await queryRunner.manager
          .createQueryBuilder(Booking, 'booking')
          .where('booking.vehicle = :vehicleId', {
            vehicleId: bookingdto.vehicle_id,
          })
          // Chỉ check các booking "sống": Đã thanh toán, đang đỗ, hoặc đang chờ thanh toán
          .andWhere('booking.status IN (:...statuses)', {
            statuses: [
              BookingStatus.PENDING,
              BookingStatus.CONFIRMED,
              BookingStatus.ONGOING,
            ],
          })
          // Công thức overlap: (Start1 < End2) AND (End1 > Start2)
          .andWhere('booking.start_time < :endTime', { endTime })
          .andWhere('booking.end_time > :startTime', { startTime })
          .getOne();

        if (conflictingVehicle) {
          throw new BadRequestException(
            `Xe này đã có lịch đặt chỗ trong khoảng thời gian từ ${dayjs(conflictingVehicle.start_time).format('HH:mm')} đến ${dayjs(conflictingVehicle.end_time).format('HH:mm')}`,
          );
        }

        const slot = await queryRunner.manager.findOne(ParkingSlot, {
          where: { id: bookingdto.slot_id },
        });

        if (!slot) {
          throw new NotFoundException('Không tìm thấy chỗ đỗ');
        }

        // Kiểm tra trạng thái
        if (slot.status.toLowerCase() === 'booked') {
          throw new BadRequestException('Chỗ này đã được đặt');
        }

        // Kiểm tra xem user đã có booking pending nào chưa
        let newbooking = await queryRunner.manager.findOne(Booking, {
          where: {
            user: { id: bookingdto.user_id },
            status: BookingStatus.PENDING,
          },
          relations: ['qrCode'],
        });

        if (newbooking) {
          // Náº¾U CÃ“: Cáº­p nháº­t láº¡i thÃ´ng tin má»›i vÃ o báº£n ghi cÅ©
          newbooking.start_time = new Date(bookingdto.start_time);
          newbooking.end_time = new Date(bookingdto.end_time);
          newbooking.vehicle = { id: bookingdto.vehicle_id } as any;
          newbooking.slot = { id: bookingdto.slot_id } as any;
          newbooking.created_at = new Date();
        } else {
          newbooking = queryRunner.manager.create(Booking, {
            start_time: bookingdto.start_time,
            end_time: bookingdto.end_time,
            status: BookingStatus.PENDING,
            user: { id: bookingdto.user_id },
            vehicle: { id: bookingdto.vehicle_id },
            slot: { id: bookingdto.slot_id },
          });
        }
        const savedBooking = await queryRunner.manager.save(
          Booking,
          newbooking,
        );

        // Náº¿u cÃ³ mÃ£ voucher, thÃ¬ validate vÃ  Ã¡p dá»¥ng nÃ³ vÃ o booking má»›i táº¡o nÃ y (trÆ°á»›c khi táº¡o invoice)
        await this.voucherService.rollbackUsageForBooking(
          savedBooking.id,
          queryRunner.manager,
        );

        let appliedVoucher: { id: string } | null = null;
        let discountAmount = 0;

        if (voucherCode) {
          if (subTotal <= 0) {
            throw new BadRequestException('Gia tri don hang khong hop le');
          }

          const result = await this.voucherService.validateAndLockVoucher(
            voucherCode,
            bookingdto.user_id,
            subTotal,
            queryRunner.manager,
          );

          appliedVoucher = { id: result.voucher.id };
          discountAmount = result.discountAmount;

          await this.voucherService.applyVoucherUsage(
            result.voucher,
            savedBooking.id,
            bookingdto.user_id,
            queryRunner.manager,
          );
        }

        const total = Math.max(0, subTotal - discountAmount);
        const invoiceRepo = queryRunner.manager.getRepository(Invoice);
        let invoice = await invoiceRepo.findOne({
          where: { booking: { id: savedBooking.id } },
        });

        if (invoice) {
          invoice.sub_total = subTotal;
          invoice.discount_amount = discountAmount;
          invoice.total = total;
          invoice.tax = invoice.tax ?? 0;
          invoice.status = InvoiceStatus.PENDING;
          invoice.voucher = appliedVoucher as any;
        } else {
          invoice = invoiceRepo.create({
            booking: savedBooking,
            sub_total: subTotal,
            discount_amount: discountAmount,
            total,
            tax: 0,
            status: InvoiceStatus.PENDING,
            voucher: appliedVoucher,
          });
        }

        await invoiceRepo.save(invoice);

        // Táº¡o QR
        const qrRepo = queryRunner.manager.getRepository(QRCode);
        let qrCode = await qrRepo.findOne({
          where: { booking: { id: savedBooking.id } },
        });

        if (!qrCode) {
          qrCode = qrRepo.create({
            booking: savedBooking,
            content: `PARK-${randomUUID()}`,
            status: 'active',
          });
        } else {
          // Náº¿u Ä‘Ã£ cÃ³ QR rá»“i, cÃ³ thá»ƒ cáº­p nháº­t ná»™i dung má»›i náº¿u muá»‘n, hoáº·c giá»¯ nguyÃªn
          qrCode.status = 'active';
        }

        await qrRepo.save(qrCode);

        await queryRunner.commitTransaction();

        // Activity log cho viá»‡c táº¡o má»›i booking
        this.activityService.templateforBookingActivity(
          savedBooking.id,
          bookingdto.user_id,
          ActivityType.BOOKING_NEW,
          ActivityStatus.SUCCESS,
        );

        return {
          ...savedBooking,
          qrCodeContent: qrCode.content, //tráº£ vá» Ä‘á»ƒ app váº½ hÃ¬nh QR
        };
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
      } finally {
        await queryRunner.release();
      }
    } catch (error) {
      // In lá»—i ra terminal Ä‘á»ƒ báº¡n Ä‘á»c Ä‘Æ°á»£c nÃ³ bá»‹ gÃ¬
      console.error('Lá»–I Táº I CREATE_BOOKING:', error);
      throw error; // Pháº£i throw lá»—i Ä‘á»ƒ NestJS tráº£ vá» HTTP 500/400 cho Frontend
    }
  }

  // =================  BOOKING (GIA Háº N) =================
  async extendBooking(
    id: number,
    extendDto: { new_end_time: string; isPreview?: boolean },
    currentUserId?: string,
  ) {
    return await this.dataSource.transaction(async (manager) => {
      // 1. Láº¥y thÃ´ng tin booking vÃ  cÃ¡c quan há»‡
      const booking = await manager.findOne(Booking, {
        where: { id },
        relations: [
          'slot',
          'user',
          'slot.parkingZone',
          'slot.parkingZone.parkingFloor',
          'slot.parkingZone.parkingFloor.parkingLot',
          'slot.parkingZone.parkingFloor.parkingLot.owner',
        ],
      });

      if (!booking) throw new NotFoundException('KhÃ´ng tÃ¬m tháº¥y Ä‘Æ¡n Ä‘áº·t chá»—');

      // SECURITY CHECK: Chá»‰ chá»§ nhÃ¢n Ä‘Æ¡n hÃ ng má»›i Ä‘Æ°á»£c gia háº¡n
      if (currentUserId && booking.user.id !== currentUserId) {
        throw new BadRequestException(
          'Báº¡n khÃ´ng cÃ³ quyá»n gia háº¡n Ä‘Æ¡n hÃ ng nÃ y',
        );
      }

      // 2. Láº¥y Ä‘Æ¡n giÃ¡ thá»±c táº¿ theo Zone (Khu vá»±c) tá»« Database
      const pricing = await manager.findOne(PricingRule, {
        where: { parkingZone: { id: Number(booking.slot.parkingZone.id) } },
        order: { id: 'DESC' },
      });
      console.log('DEBUG: TÃ¬m giÃ¡ cho Zone ID =', booking.slot.parkingZone.id);
      console.log('DEBUG: Káº¿t quáº£ Pricing =', pricing);

      const pricePerHour = pricing?.price_per_hour || 0;
      const priceDay = pricing?.price_per_day || 0;
      const zoneName = booking.slot.parkingZone.zone_name || 'Khu vá»±c';

      const oldEndTime = dayjs(booking.end_time);
      const newEndTime = dayjs(extendDto.new_end_time);

      if (newEndTime.isBefore(oldEndTime) || newEndTime.isSame(oldEndTime)) {
        throw new BadRequestException('Giá» káº¿t thÃºc má»›i pháº£i sau giá» hiá»‡n táº¡i');
      }

      // 3. Kiá»ƒm tra xung Ä‘á»™t Slot
      const conflict = await manager
        .createQueryBuilder(Booking, 'b')
        .where('b.slot_id = :slotId', { slotId: booking.slot.id })
        .andWhere('b.id != :id', { id })
        .andWhere('b.status IN (:...st)', {
          st: [BookingStatus.CONFIRMED, BookingStatus.ONGOING],
        })
        .andWhere('b.start_time < :newEndTime', {
          newEndTime: newEndTime.toISOString(),
        })
        .andWhere('b.end_time > :oldEndTime', {
          oldEndTime: oldEndTime.toISOString(),
        })
        .getOne();

      if (conflict)
        throw new BadRequestException(
          'Vá»‹ trÃ­ nÃ y Ä‘Ã£ cÃ³ ngÆ°á»i Ä‘áº·t trÆ°á»›c trong khung giá» báº¡n muá»‘n gia háº¡n!',
        );

      // 3.5. Kiá»ƒm tra giá» hoáº¡t Ä‘á»™ng cá»§a bÃ£i xe
      const parkingLot = booking.slot.parkingZone.parkingFloor.parkingLot;
      
      const lotOpenTime = parkingLot.open_time;
      const lotCloseTime = parkingLot.close_time;

      let validationError: string | null = null;
      let openStr = '00:00';
      let closeStr = '23:59';

      if (lotOpenTime && lotCloseTime) {
        openStr = dayjs(lotOpenTime).format('HH:mm');
        closeStr = dayjs(lotCloseTime).format('HH:mm');
        const extendTimeStr = newEndTime.format('HH:mm');

        // 1. Kiá»ƒm tra trong khoáº£ng giá» hoáº¡t Ä‘á»™ng
        if (openStr < closeStr) {
          if (extendTimeStr < openStr || extendTimeStr > closeStr) {
            validationError = `BÃ£i xe chá»‰ hoáº¡t Ä‘á»™ng tá»« ${openStr} Ä‘áº¿n ${closeStr}. Vui lÃ²ng chá»n giá» gia háº¡n trong khoáº£ng nÃ y.`;
          }
        } else if (openStr > closeStr) {
          if (extendTimeStr < openStr && extendTimeStr > closeStr) {
            validationError = `BÃ£i xe chá»‰ hoáº¡t Ä‘á»™ng tá»« ${openStr} Ä‘áº¿n ${closeStr}. Vui lÃ²ng chá»n giá» gia háº¡n trong khoáº£ng nÃ y.`;
          }
        }

        // 2. Kiá»ƒm tra gia háº¡n qua Ä‘Ãªm (náº¿u khÃ´ng pháº£i 24/7)
        const isOpen247 = openStr === '00:00' && closeStr === '23:59';
        if (!validationError && !isOpen247) {
          const oldDateStr = dayjs(booking.start_time).format('YYYY-MM-DD');
          const newEndDateStr = newEndTime.format('YYYY-MM-DD');
          if (oldDateStr !== newEndDateStr) {
            validationError = 'BÃ£i xe khÃ´ng há»— trá»£ gia háº¡n qua Ä‘Ãªm. Vui lÃ²ng chá»n giá» káº¿t thÃºc trong cÃ¹ng ngÃ y.';
          }
        }
      }

      // Náº¿u thá»±c hiá»‡n gia háº¡n tháº­t vÃ  cÃ³ lá»—i -> Cháº·n láº¡i
      if (!extendDto.isPreview && validationError) {
        throw new BadRequestException(validationError);
      }

      // 4. ÃP Dá»¤NG CÃ”NG THá»¨C Äá»’NG NHáº¤T Vá»šI FRONTEND
      const isSameDay = oldEndTime.isSame(newEndTime, 'day');
      const totalHoursExtend = newEndTime.diff(oldEndTime, 'hour', true);

      let extraAmount = 0;
      if (isSameDay) {
        // 1. Trong cÃ¹ng 1 ngÃ y: TÃ­nh theo giá», lÃ m trÃ²n lÃªn
        extraAmount = Math.ceil(totalHoursExtend) * pricePerHour;
      } else {
        // 2. Qua Ä‘Ãªm hoáº·c nhiá»u ngÃ y: TÃ­nh theo ngÃ y
        const numberOfDays = Math.ceil(totalHoursExtend / 24);
        extraAmount = numberOfDays * priceDay;
      }

      const days = Math.floor(totalHoursExtend / 24);
      const remainingMinutes = Math.round((totalHoursExtend % 24) * 60);
      const totalMinutesExtend = Math.round(totalHoursExtend * 60);

      // Tráº£ vá» Preview hiá»ƒn thá»‹ trÃªn UI
      if (extendDto.isPreview) {
        return {
          data: {
            extraAmount: extraAmount > 0 ? extraAmount : 0,
            pricePerHour,
            priceDay,
            zoneName,
            totalMinutesExtend,
            days,
            remainingMinutes,
            isValid: !validationError,
            message: validationError,
            operatingHours: {
              open: openStr,
              close: closeStr,
            },
          },
        };
      }


      // 5. Táº¡o hÃ³a Ä‘Æ¡n gia háº¡n (Tráº¡ng thÃ¡i PENDING Ä‘á»ƒ thu tiá»n máº·t táº¡i quáº§y khi check-out)
      // 5. Thanh toÃ¡n thá»±c táº¿
      if (extraAmount > 0) {
        const invoiceData: any = {
          booking: booking,
          sub_total: extraAmount,
          discount_amount: 0,
          total: extraAmount,
          tax: 0,
          description: `Gia háº¡n thÃªm ${days > 0 ? days + ' ngÃ y ' : ''}${remainingMinutes} phÃºt táº¡i ${zoneName}`,
          status: InvoiceStatus.PENDING,
        };

        const newInvoice = manager.create(Invoice, invoiceData);
        await manager.save(newInvoice);
      }

      // 6. Cáº­p nháº­t giá» má»›i vÃ o database
      booking.end_time = newEndTime.toDate();
      const updatedBooking = await manager.save(booking);

      // Activity log cho viá»‡c táº¡o má»›i booking
      this.activityService.templateforBookingActivity(
        updatedBooking.id,
        updatedBooking.user.id,
        ActivityType.BOOKING_EXTENDED,
        ActivityStatus.SUCCESS,
      );

      return {
        message: 'Gia háº¡n thÃ nh cÃ´ng',
        data: updatedBooking,
      };
    });
  }

  // ================= scanQR =================
  async scanQRCode(
    content: string,
    gateId: number,
    detectedPlate: string,
    user: any,
    imageUrl?: string,
  ) {
    console.log(
      `>>> [scanQRCode] Báº®T Äáº¦U QUÃ‰T: content="${content}", gateId=${gateId}, detectedPlate="${detectedPlate}"`,
    );
    const trimmedContent = content?.trim();

    // 1. Kiá»ƒm tra cá»•ng
    const gate = await this.checkLogRepository.manager.findOne(Gate, {
      where: { id: gateId },
      relations: ['parkingLot', 'parkingLot.owner'],
    });
    if (!gate) {
      console.error(`[scanQRCode] Lá»–I: Cá»•ng ${gateId} khÃ´ng tá»“n táº¡i`);
      throw new NotFoundException('Cá»•ng khÃ´ng tá»“n táº¡i');
    }

    // SECURITY CHECK: Kiá»ƒm tra quyá»n truy cáº­p bÃ£i xe cá»§a ngÆ°á»i quÃ©t
    await this.parkingLotService.validateLotAccess(gate.parkingLot.id, user);

    // 2. Kiá»ƒm tra mÃ£ QR
    const qrCode = await this.qrcodeRepository.findOne({
      where: { content: trimmedContent },
      relations: [
        'booking',
        'booking.user',
        'booking.slot',
        'booking.vehicle',
        'booking.slot.parkingZone',
        'booking.slot.parkingZone.parkingFloor',
        'booking.slot.parkingZone.parkingFloor.parkingLot',
        'booking.slot.parkingZone.parkingFloor.parkingLot.owner',
        'booking.invoice',
      ],
    });

    if (!qrCode) {
      console.error(
        `[scanQRCode] Lá»–I: KhÃ´ng tÃ¬m tháº¥y QR content="${trimmedContent}"`,
      );
      throw new NotFoundException('MÃ£ QR khÃ´ng tá»“n táº¡i trong há»‡ thá»‘ng');
    }

    if (qrCode.status !== 'active') {
      console.error(
        `[scanQRCode] Lá»–I: QR content="${trimmedContent}" Ä‘ang á»Ÿ tráº¡ng thÃ¡i ${qrCode.status}`,
      );
      throw new BadRequestException(
        `MÃ£ QR Ä‘Ã£ ${qrCode.status === 'used' ? 'Ä‘Æ°á»£c sá»­ dá»¥ng' : 'háº¿t háº¡n hoáº·c khÃ´ng hiá»‡u lá»±c'}`,
      );
    }

    const booking = qrCode.booking;

    // 3. SO KHá»šP BIá»‚N Sá» XE (Sá»¬ Dá»¤NG LEVENSHTEIN DISTANCE)
    if (detectedPlate && booking.vehicle) {
      const cleanDetected = detectedPlate
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
      const cleanRegistered = booking.vehicle.plate_number
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');

      console.log('So khá»›p:', cleanDetected, 'vs', cleanRegistered);

      // Thuáº­t toÃ¡n Levenshtein Distance Ä‘á»ƒ tÃ­nh Ä‘á»™ lá»‡ch chuá»—i
      const getLevenshteinDistance = (a: string, b: string) => {
        const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
        for (let j = 1; j <= b.length; j++) matrix[0][j] = j;

        for (let i = 1; i <= a.length; i++) {
          for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
              matrix[i - 1][j] + 1, // xÃ³a
              matrix[i][j - 1] + 1, // thÃªm
              matrix[i - 1][j - 1] + cost, // thay tháº¿
            );
          }
        }
        return matrix[a.length][b.length];
      };

      const distance = getLevenshteinDistance(cleanDetected, cleanRegistered);
      const isMatch =
        distance <= 2 ||
        cleanDetected.includes(cleanRegistered) ||
        cleanRegistered.includes(cleanDetected);

      if (!isMatch) {
        throw new BadRequestException(
          `Biá»ƒn sá»‘ khÃ´ng khá»›p! Há»‡ thá»‘ng lá»c Ä‘Æ°á»£c: ${cleanDetected}, ÄÄƒng kÃ½: ${booking.vehicle.plate_number}`,
        );
      }
    } else if (!detectedPlate) {
      throw new BadRequestException(
        'Vui lÃ²ng cung cáº¥p áº£nh biá»ƒn sá»‘ xe Ä‘á»ƒ Ä‘á»‘i chiáº¿u',
      );
    }

    //check-in
    if (
      booking.status === BookingStatus.CONFIRMED ||
      booking.status === BookingStatus.PENDING
    ) {
      // RÃ ng buá»™c: Check-in khÃ´ng Ä‘Æ°á»£c phÃ©p táº¡i cá»•ng chá»‰ dÃ nh cho lá»‘i ra (OUT)
      if (gate.type === 'OUT') {
        throw new BadRequestException(
          `Cá»•ng "${gate.name}" chá»‰ dÃ nh cho lá»‘i ra. Vui lÃ²ng quÃ©t táº¡i cá»•ng lá»‘i vÃ o.`,
        );
      }

      // Kiá»ƒm tra Ä‘áº¿n sá»›m (Check-in sá»›m).Cho phÃ©p check-in sá»›m 10p
      const now = new Date();
      if (now < booking.start_time) {
        const diffMs = booking.start_time.getTime() - now.getTime();
        const diffMins = Math.ceil(diffMs / 60000);

        if (diffMins > 10) {
          throw new BadRequestException(
            `Báº¡n Ä‘áº¿n quÃ¡ sá»›m. Vui lÃ²ng quay láº¡i sau ${diffMins - 10} phÃºt ná»¯a (há»‡ thá»‘ng cho phÃ©p check-in sá»›m tá»‘i Ä‘a 10 phÃºt).`,
          );
        }
        // Náº¿u diffMins <= 10, tiáº¿p tá»¥c xá»­ lÃ½ nhÆ°ng cÃ³ thá»ƒ Ä‘Ã¡nh dáº¥u Ä‘á»ƒ Ä‘á»•i message thÃ nh "ChÃ o má»«ng báº¡n Ä‘áº¿n sá»›m!"
      }

      // Kiá»ƒm tra quÃ¡ háº¡n check-in (Náº¿u giá» hiá»‡n táº¡i > end_time)
      if (now > booking.end_time) {
        console.warn(
          `[scanQRCode] Booking #${booking.id} Ä‘Ã£ quÃ¡ háº¡n. Äang tá»± Ä‘á»™ng dá»n dáº¹p...`,
        );

        // Tá»± Ä‘á»™ng giáº£i phÃ³ng slot vÃ  Ä‘Ã¡nh dáº¥u booking káº¿t thÃºc
        booking.status = BookingStatus.COMPLETED;
        qrCode.status = 'used';

        if (booking.slot) {
          booking.slot.status = SlotStatus.AVAILABLE;
          await this.parkingSlotRepository.save(booking.slot);
          console.log(
            `[scanQRCode] Slot ${booking.slot.code} Ä‘Ã£ Ä‘Æ°á»£c giáº£i phÃ³ng.`,
          );
        }

        await this.qrcodeRepository.save(qrCode);
        await this.bookingRepository.save(booking);

        throw new BadRequestException(
          'Báº¡n Ä‘Ã£ quÃ¡ háº¡n check-in (thá»i gian Ä‘áº·t chá»— Ä‘Ã£ káº¿t thÃºc). Há»‡ thá»‘ng Ä‘Ã£ tá»± Ä‘á»™ng káº¿t thÃºc lÆ°á»£t Ä‘áº·t nÃ y vÃ  giáº£i phÃ³ng vá»‹ trÃ­ Ä‘á»—.',
        );
      }

      const isAlreadyPaid = booking.status === BookingStatus.CONFIRMED;
      booking.status = BookingStatus.ONGOING;

      const newLog = this.checkLogRepository.create({
        booking: booking,
        gate: { id: gateId }, // Sá»­ dá»¥ng quan há»‡ gate vá»›i ID truyá»n vÃ o tá»« mobile/camera
        check_status: 'in',
        time: new Date(),
        image_url: imageUrl,
      });

      await this.checkLogRepository.save(newLog);
      await this.bookingRepository.save(booking);

      let successMessage = isAlreadyPaid
        ? ' Check-in thÃ nh cÃ´ng!'
        : 'Check in thÃ nh cÃ´ng. Vui lÃ²ng thu phÃ­';

      if (now < booking.start_time) {
        successMessage = `Check-in thÃ nh cÃ´ng.ChÃ o má»«ng báº¡n Ä‘áº¿n sá»›m!${isAlreadyPaid ? '' : ' Vui lÃ²ng thu phÃ­.'}`;
      }

      return {
        message: successMessage,
        type: 'in',
      };
    }

    //check-out
    if (booking.status === BookingStatus.ONGOING) {
      // RÃ ng buá»™c: Check-out khÃ´ng Ä‘Æ°á»£c phÃ©p táº¡i cá»•ng chá»‰ dÃ nh cho lá»‘i vÃ o (IN)
      if (gate.type === 'IN') {
        throw new BadRequestException(
          `Cá»•ng "${gate.name}" chá»‰ dÃ nh cho lá»‘i vÃ o. Vui lÃ²ng quÃ©t táº¡i cá»•ng lá»‘i ra.`,
        );
      }

      // 4. TÃNH PHÃ PHáº T Náº¾U RA MUá»˜N (15 PHÃšT Ã‚N Háº N)
      const pricing = await this.dataSource.manager.findOne(PricingRule, {
        where: { parkingZone: { id: Number(booking.slot.parkingZone.id) } },
        order: { id: 'DESC' },
      });

      const actualExitTime = new Date();
      const penaltyInfo = this.calculateLatePenalty(
        booking.end_time,
        actualExitTime,
        pricing?.price_per_hour || 0,
        pricing?.price_per_day || 0,
      );

      // 4. KIá»‚M TRA PHÃ PHáº T (QUÃ Háº N)
      if (penaltyInfo.isLate && penaltyInfo.penaltyFee > 0) {
        return {
          requirePayment: true,
          type: 'out',
          message: `KhÃ¡ch Ä‘Ã£ quÃ¡ thá»i gian Ä‘á»— xe: ${penaltyInfo.penaltyFee.toLocaleString()}Ä‘`,
          penalty: {
            ...penaltyInfo,
            bookingId: booking.id,
            plate: booking.vehicle?.plate_number || detectedPlate || "???",
          },
          imageUrl: imageUrl,
          content: content // Tráº£ vá» content QR Ä‘á»ƒ confirmPayment dÃ¹ng
        };
      }

      // 5. TÃNH PHÃ GIA Háº N CHÆ¯A THANH TOÃN
      const pendingExtensionInvoices = booking.invoice?.filter(
        (inv) => inv.status === InvoiceStatus.PENDING && Number(inv.total) > 0
      ) || [];
      const extensionFee = pendingExtensionInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);

      if (extensionFee > 0) {
        return {
          requirePayment: true,
          extensionFee,
          bookingId: booking.id,
          plate: booking.vehicle?.plate_number || detectedPlate || "???",
          message: `KhÃ¡ch cÃ³ phÃ­ gia háº¡n chÆ°a thanh toÃ¡n: ${extensionFee.toLocaleString()}Ä‘`,
          type: 'out',
          imageUrl: imageUrl,
          content: content
        };
      }

      booking.status = BookingStatus.COMPLETED;
      qrCode.status = 'used';

      if (booking.slot) {
        booking.slot.status = SlotStatus.AVAILABLE;
        await this.parkingSlotRepository.save(booking.slot);
      }

      const newLog = this.checkLogRepository.create({
        booking: booking,
        gate: { id: gateId },
        check_status: 'out',
        time: actualExitTime,
        image_url: imageUrl,
      });

      await this.checkLogRepository.save(newLog);
      await this.qrcodeRepository.save(qrCode);
      await this.bookingRepository.save(booking);

      return {
        message: 'Checkout thÃ nh cÃ´ng!',
        type: 'out',
        imageUrl: imageUrl,
      };
    }
    throw new BadRequestException(
      'tráº¡ng thÃ¡i booking khÃ´ng há»£p lá»‡ Ä‘á»ƒ thá»±c hiá»‡n',
    );
  }

  async confirmPaymentAndCheckout(data: { bookingId: number, gateId: number, imageUrl?: string, content: string, penaltyFee?: number }) {
    return await this.dataSource.transaction(async (manager) => {
      // 1. Láº¥y thÃ´ng tin booking
      const booking = await manager.findOne(Booking, {
        where: { id: data.bookingId },
        relations: ['slot', 'invoice', 'vehicle'],
      });

      if (!booking) throw new NotFoundException('KhÃ´ng tÃ¬m tháº¥y Ä‘Æ¡n Ä‘áº·t chá»—');

      // 2. Láº¥y QR Code
      const qrCode = await manager.findOne(QRCode, {
        where: { content: data.content },
      });

      // 3. Cáº­p nháº­t cÃ¡c hÃ³a Ä‘Æ¡n PENDING thÃ nh PAID (XÃ¡c nháº­n Ä‘Ã£ nháº­n tiá»n máº·t)
      const pendingInvoices = booking.invoice?.filter(
        (inv) => inv.status === InvoiceStatus.PENDING
      );
      if (pendingInvoices) {
        for (const inv of pendingInvoices) {
          inv.status = InvoiceStatus.PAID;
          await manager.save(inv);
        }
      }

      // 4. Náº¿u cÃ³ phÃ­ pháº¡t (truyá»n tá»« frontend), táº¡o hÃ³a Ä‘Æ¡n PAID
      if (data.penaltyFee && data.penaltyFee > 0) {
        const penaltyInvoice = manager.create(Invoice, {
          booking,
          sub_total: data.penaltyFee,
          total: data.penaltyFee,
          tax: 0,
          status: InvoiceStatus.PAID,
        });
        await manager.save(penaltyInvoice);
      }

      // 4. Cáº­p nháº­t tráº¡ng thÃ¡i
      booking.status = BookingStatus.COMPLETED;
      if (booking.slot) {
        booking.slot.status = SlotStatus.AVAILABLE;
        await manager.save(booking.slot);
      }
      if (qrCode) {
        qrCode.status = 'used';
        await manager.save(qrCode);
      }
      await manager.save(booking);

      // 5. Táº¡o CheckLog (Ra)
      const newLog = manager.create(CheckLog, {
        booking: booking,
        gate: { id: data.gateId } as any,
        check_status: 'out',
        time: new Date(),
        image_url: data.imageUrl,
      });
      await manager.save(newLog);

      return {
        message: 'XÃ¡c nháº­n thanh toÃ¡n vÃ  hoÃ n táº¥t check-out thÃ nh cÃ´ng!',
        bookingId: booking.id
      };
    });
  }

  // ================= GET ALL BOOKING =================

  getAllBooking() {
    return this.bookingRepository.find({
      relations: [
        'user',
        'user.profile',
        'vehicle',
        'slot',
        'slot.parkingZone',
        'slot.parkingZone.parkingFloor',
        'slot.parkingZone.parkingFloor.parkingLot',
        'invoice',
      ],
    });
  }

  // ================= BOOKING BY USER =================

  getBookingByUser(userid: string) {
    return this.bookingRepository.find({
      where: {
        user: {
          id: userid,
        },
      },
      relations: [
        'user',
        'qrCode',
        'slot',
        'slot.parkingZone',
        'slot.parkingZone.parkingFloor',
        'slot.parkingZone.parkingFloor.parkingLot',
        'vehicle',
        'user.profile',
        'invoice',
      ],
      order: {
        id: 'DESC',
      },
    });
  }

  // ================= GET ACTIVE BOOKING BY SLOT =================
  async getActiveBookingBySlot(slotId: number) {
    const booking = await this.bookingRepository.findOne({
      where: {
        slot: { id: slotId },
        status: In([BookingStatus.CONFIRMED, BookingStatus.ONGOING]),
      },
      relations: [
        'user',
        'user.profile',
        'vehicle',
        'slot',
        'slot.parkingZone',
        'slot.parkingZone.parkingFloor',
        'slot.parkingZone.parkingFloor.parkingLot',
        'invoice',
      ],
      order: { created_at: 'DESC' },
    });

    if (!booking) {
      throw new NotFoundException(
        'KhÃ´ng tÃ¬m tháº¥y Ä‘Æ¡n Ä‘áº·t chá»— hoáº¡t Ä‘á»™ng táº¡i vá»‹ trÃ­ nÃ y',
      );
    }

    return booking;
  }

  // danh sÃ¡ch cÃ¡c xe Ä‘áº·t(Ve-QR)
  async getLatestActiveBooking(vehicleId: number, userId: string) {
    const data = await this.bookingRepository.findOne({
      where: [
        {
          vehicle: { id: vehicleId },
          user: { id: userId },
        },
      ],
      relations: [
        'slot',
        'slot.parkingZone',
        'slot.parkingZone.parkingFloor',
        'slot.parkingZone.parkingFloor.parkingLot',
        'slot.parkingZone.parkingFloor.parkingLot.owner',
        'qrCode',
      ],
      // Quan trá»ng: Sáº¯p xáº¿p theo ID hoáº·c thá»i gian táº¡o giáº£m dáº§n Ä‘á»ƒ láº¥y cÃ¡i má»›i nháº¥t
      order: {
        created_at: 'DESC',
      },
    });
    console.log('>>> [BE] Káº¿t quáº£ tÃ¬m kiáº¿m:', data);
    return data;
  }

  // ================= BOOKING BY PARKING LOT =================

  async getBookingByParkingLot(
    lotId: number,
    user: any,
    search?: string,
    startDate?: string,
    endDate?: string,
  ) {
    await this.parkingLotService.validateLotAccess(lotId, user);
    const query = this.bookingRepository
      .createQueryBuilder('booking')
      .leftJoinAndSelect('booking.user', 'user')
      .leftJoinAndSelect('user.profile', 'profile')
      .leftJoinAndSelect('booking.vehicle', 'vehicle')
      .leftJoinAndSelect('booking.slot', 'slot')
      .leftJoinAndSelect('slot.parkingZone', 'parkingZone')
      .leftJoinAndSelect('parkingZone.parkingFloor', 'parkingFloor')
      .leftJoinAndSelect('parkingFloor.parkingLot', 'parkingLot')
      .leftJoinAndSelect('booking.invoice', 'invoice')
      .leftJoinAndSelect('booking.qrCode', 'qrCode')
      .where('parkingLot.id = :lotId', { lotId });

    if (startDate && endDate) {
      query.andWhere('booking.start_time BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      });
    } else if (startDate) {
      query.andWhere('booking.start_time >= :startDate', { startDate });
    }

    if (search) {
      const isNumeric = !isNaN(Number(search));
      if (isNumeric) {
        query.andWhere(
          '(booking.id = :searchId OR LOWER(vehicle.plate_number) LIKE LOWER(:searchLike) OR LOWER(qrCode.content) LIKE LOWER(:searchLike))',
          {
            searchId: Number(search),
            searchLike: `%${search}%`,
          },
        );
      } else {
        query.andWhere(
          '(LOWER(vehicle.plate_number) LIKE LOWER(:searchLike) OR LOWER(qrCode.content) LIKE LOWER(:searchLike))',
          {
            searchLike: `%${search}%`,
          },
        );
      }
    }

    query.orderBy('booking.created_at', 'DESC');

    return query.getMany();
  }

  // ================= UPDATE BOOKING =================

  async updateBooking(id: number, bookingdto: any) {
    const updateData: any = {};

    if (bookingdto.start_time) updateData.start_time = bookingdto.start_time;
    if (bookingdto.end_time) updateData.end_time = bookingdto.end_time;
    if (bookingdto.status) updateData.status = bookingdto.status;
    if (bookingdto.user_id) updateData.user = { id: bookingdto.user_id };
    if (bookingdto.vehicle_id)
      updateData.vehicle = { id: bookingdto.vehicle_id };
    if (bookingdto.slot_id) updateData.slot = { id: bookingdto.slot_id };

    await this.bookingRepository.update(id, updateData);

    return this.bookingRepository.findOne({
      where: { id },
    });
  }

  // ================= DELETE BOOKING =================

  async deleteBooking(id: number) {
    const booking = await this.bookingRepository.findOne({
      where: { id },
      relations: [
        'user',
        'user.profile',
        'slot',
        'slot.parkingZone',
        'slot.parkingZone.parkingFloor',
        'slot.parkingZone.parkingFloor.parkingLot',
      ],
    });

    if (!booking) {
      throw new NotFoundException('khÃ´ng cÃ³ booking');
    }

    await this.bookingRepository.delete(id);

    const userName =
      booking.user?.profile?.name ||
      booking.user?.email ||
      `user #${booking.user?.id ?? 'N/A'}`;
    const parkingLot = booking.slot?.parkingZone?.parkingFloor?.parkingLot;
    const parkingLotName =
      parkingLot?.name || `bÃ£i #${parkingLot?.id ?? 'N/A'}`;

    await this.activityService.logActivity({
      type: ActivityType.BOOKING_CANCELED,
      content: `NgÆ°á»i dÃ¹ng ${userName} Ä‘Ã£ há»§y chá»— táº¡i ${parkingLotName}`,
      status: ActivityStatus.WARNING,
      userId: booking.user?.id,
      meta: {
        parkingLotId: booking.slot?.parkingZone?.parkingFloor?.parkingLot?.id,
      },
    });

    return booking;
  }

  // ================= QR CODE =================

  async createQRcode(qrcodedto: any) {
    const checkqrcode = await this.qrcodeRepository.findOne({
      where: {
        booking: { id: qrcodedto.booking_id },
      },
    });

    if (checkqrcode) {
      throw new BadRequestException('Ä‘Ã£ cÃ³ qr cho booking nÃ y');
    }

    const newQRcode = this.qrcodeRepository.create({
      booking: { id: qrcodedto.booking_id },
      content: qrcodedto.content,
      status: qrcodedto.status,
    });

    return this.qrcodeRepository.save(newQRcode);
  }

  getAllQRcode() {
    return this.qrcodeRepository.find({
      relations: ['booking'],
    });
  }

  // ================= SEND EMAIL =================

  async sendEmail(bookingId: number) {
    const booking = await this.bookingRepository.findOne({
      where: { id: bookingId },
      relations: [
        'user',
        'user.profile',
        'qrCode',
        'vehicle',
        'slot',
        'slot.parkingZone',
        'slot.parkingZone.parkingFloor',
        'slot.parkingZone.parkingFloor.parkingLot',
      ],
    });

    if (!booking) {
      throw new NotFoundException('khÃ´ng tÃ¬m tháº¥y booking');
    }

    const displayName = booking.user.profile.name;

    const floorDetails = booking.slot?.parkingZone?.parkingFloor;
    const parkingLot = floorDetails?.parkingLot;

    return this.emailService.sendBookingQREmail(
      booking.user.email,
      displayName,
      {
        qrContent: booking.qrCode?.content,
        parkingLot: parkingLot?.name,
        endTime: new Date(booking.end_time).toLocaleString('vi-VN'),
        code: booking.slot?.code,
        floor_number: booking.slot?.parkingZone?.parkingFloor?.floor_number,
        floor_zone: booking.slot?.parkingZone?.zone_name,
        startTime: new Date(booking.start_time).toLocaleString('vi-VN'),
      },
    );
  }

  // ================== Thá»‘ng kÃª sá»‘ lÆ°á»£ng booking hÃ´m nay (ADMIN) =================
  async countTodayBookings() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return this.bookingRepository.count({
      where: {
        start_time: Between(today, tomorrow),
      },
    });
  }

  // =========== TÃ­nh doanh thu trong thÃ¡ng (ADMIN) ================
  async calculateMonthlyRevenue() {
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const firstDayOfNextMonth = new Date(
      today.getFullYear(),
      today.getMonth() + 1,
      1,
    );

    const revenue = await this.bookingRepository
      .createQueryBuilder('booking')
      .leftJoinAndSelect('booking.invoice', 'invoice')
      .where('booking.start_time >= :start AND booking.start_time < :end', {
        start: firstDayOfMonth,
        end: firstDayOfNextMonth,
      })
      .andWhere('invoice.status = :status', { status: InvoiceStatus.PAID })
      .select('SUM(invoice.total)', 'total')
      .getRawOne();

    return parseFloat(revenue.total) || 0;
  }

  // ================= OWNER ANALYTICS =================

  async getOwnerMetrics(ownerId: string, lotId?: number) {
    const today = new Date();
    const firstDayOfThisMonth = new Date(
      today.getFullYear(),
      today.getMonth(),
      1,
    );
    const firstDayOfNextMonth = new Date(
      today.getFullYear(),
      today.getMonth() + 1,
      1,
    );
    const firstDayOfLastMonth = new Date(
      today.getFullYear(),
      today.getMonth() - 1,
      1,
    );

    // This month revenue
    const thisMonthData = await this.bookingRepository
      .createQueryBuilder('b')
      .leftJoin('b.invoice', 'i')
      .leftJoin('b.slot', 's')
      .leftJoin('s.parkingZone', 'z')
      .leftJoin('z.parkingFloor', 'f')
      .leftJoin('f.parkingLot', 'l')
      .leftJoin('l.owner', 'owner')
      .where('owner.id = :ownerId', { ownerId })
      .andWhere(lotId ? 'l.id = :lotId' : '1=1', { lotId })
      .andWhere('b.start_time >= :start AND b.start_time < :end', {
        start: firstDayOfThisMonth,
        end: firstDayOfNextMonth,
      })
      // Táº¡m thá»i bá» qua status PAID Ä‘á»ƒ hiá»ƒn thá»‹ dá»¯ liá»‡u náº¿u DB chÆ°a cÃ³ payment thá»±c táº¿
      // .andWhere('i.status = :status', { status: InvoiceStatus.PAID })
      .select('SUM(COALESCE(i.total, 0))', 'total')
      .getRawOne();

    // Last month revenue
    const lastMonthData = await this.bookingRepository
      .createQueryBuilder('b')
      .leftJoin('b.invoice', 'i')
      .leftJoin('b.slot', 's')
      .leftJoin('s.parkingZone', 'z')
      .leftJoin('z.parkingFloor', 'f')
      .leftJoin('f.parkingLot', 'l')
      .leftJoin('l.owner', 'owner')
      .where('owner.id = :ownerId', { ownerId })
      .andWhere(lotId ? 'l.id = :lotId' : '1=1', { lotId })
      .andWhere('b.start_time >= :start AND b.start_time < :end', {
        start: firstDayOfLastMonth,
        end: firstDayOfThisMonth,
      })
      // Thá»‘ng kÃª doanh thu dá»± kiáº¿n tá»« cÃ¡c Ä‘Æ¡n há»£p lá»‡
      .andWhere('b.status IN (:...statuses)', {
        statuses: [
          BookingStatus.CONFIRMED,
          BookingStatus.ONGOING,
          BookingStatus.COMPLETED,
        ],
      })
      .select('SUM(COALESCE(i.total, 0))', 'total')
      .getRawOne();

    const monthlyRevenue = parseFloat(thisMonthData?.total || '0') || 0;
    const lastMonthRevenue = parseFloat(lastMonthData?.total || '0') || 0;

    let growthPercent = 0;
    if (lastMonthRevenue > 0) {
      growthPercent =
        ((monthlyRevenue - lastMonthRevenue) / lastMonthRevenue) * 100;
    } else if (monthlyRevenue > 0) {
      growthPercent = 100;
    }

    // Total Bookings this month
    const totalBookings = await this.bookingRepository
      .createQueryBuilder('b')
      .leftJoin('b.slot', 's')
      .leftJoin('s.parkingZone', 'z')
      .leftJoin('z.parkingFloor', 'f')
      .leftJoin('f.parkingLot', 'l')
      .leftJoin('l.owner', 'owner')
      .where('owner.id = :ownerId', { ownerId })
      .andWhere(lotId ? 'l.id = :lotId' : '1=1', { lotId })
      .andWhere('b.start_time >= :start AND b.start_time < :end', {
        start: firstDayOfThisMonth,
        end: firstDayOfNextMonth,
      })
      .getCount();

    // Occupancy Rate calculation
    const lotsQuery = this.bookingRepository.manager
      .createQueryBuilder(ParkingLot, 'l')
      .innerJoin('l.owner', 'owner')
      .leftJoin('l.parkingFloor', 'f')
      .leftJoin('f.parkingZones', 'z')
      .leftJoin('z.slot', 's')
      .where('owner.id = :ownerId', { ownerId });

    if (lotId) {
      lotsQuery.andWhere('l.id = :lotId', { lotId });
    }

    const slotsData = await lotsQuery
      .select('COUNT(s.id)', 'total')
      .addSelect(
        "SUM(CASE WHEN s.status = 'OCCUPIED' THEN 1 ELSE 0 END)",
        'occupied',
      )
      .getRawOne();

    const totalSlots = parseInt(slotsData.total, 10) || 0;
    const occupiedSlots = parseInt(slotsData.occupied, 10) || 0;
    const occupancyRate =
      totalSlots > 0 ? (occupiedSlots / totalSlots) * 100 : 0;

    return {
      monthlyRevenue,
      lastMonthRevenue,
      growthPercent: parseFloat(growthPercent.toFixed(2)),
      totalBookings,
      occupancyRate: parseFloat(occupancyRate.toFixed(1)),
    };
  }

  async getRevenueByMonth(ownerId: string, year: number, lotId?: number) {
    const rawData = await this.bookingRepository
      .createQueryBuilder('b')
      .leftJoin('b.invoice', 'i')
      .leftJoin('b.slot', 's')
      .leftJoin('s.parkingZone', 'z')
      .leftJoin('z.parkingFloor', 'f')
      .leftJoin('f.parkingLot', 'l')
      .leftJoin('l.owner', 'owner')
      .where('owner.id = :ownerId', { ownerId })
      .andWhere(lotId ? 'l.id = :lotId' : '1=1', { lotId })
      .andWhere('EXTRACT(YEAR FROM b.start_time) = :year', { year })
      // Táº¡m thá»i bá» qua status PAID Ä‘á»ƒ tháº¥y dá»¯ liá»‡u dá»± kiáº¿n
      // .andWhere('i.status = :status', { status: InvoiceStatus.PAID })
      .andWhere('b.status IN (:...statuses)', {
        statuses: [
          BookingStatus.CONFIRMED,
          BookingStatus.ONGOING,
          BookingStatus.COMPLETED,
        ],
      })
      .select('EXTRACT(MONTH FROM b.start_time)', 'month')
      .addSelect('SUM(COALESCE(i.total, 0))', 'revenue')
      .addSelect('COUNT(b.id)', 'bookingcount')
      .groupBy('EXTRACT(MONTH FROM b.start_time)')
      .getRawMany();

    const monthlyStats = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      revenue: 0,
      bookingCount: 0,
    }));

    rawData.forEach((row) => {
      const monthIdx = parseInt(row.month, 10) - 1;
      if (monthIdx >= 0 && monthIdx < 12) {
        monthlyStats[monthIdx].revenue = parseFloat(row.revenue) || 0;
        monthlyStats[monthIdx].bookingCount =
          parseInt(row.bookingcount, 10) || 0;
      }
    });

    return monthlyStats;
  }

  async getPaymentMethodStats(
    ownerId: string,
    lotId?: number,
    startDate?: string,
    endDate?: string,
  ) {
    try {
      // Náº¿u khÃ´ng cÃ³ ngÃ y, máº·c Ä‘á»‹nh láº¥y thÃ¡ng hiá»‡n táº¡i
      const start = startDate
        ? new Date(startDate)
        : dayjs().startOf('month').toDate();
      const end = endDate ? new Date(endDate) : dayjs().endOf('month').toDate();

      const query = this.bookingRepository
        .createQueryBuilder('b')
        .innerJoin('b.invoice', 'i')
        .leftJoin('i.payment', 'p') // DÃ¹ng leftJoin Ä‘á»ƒ khÃ´ng bá» sÃ³t cÃ¡c hÃ³a Ä‘Æ¡n chÆ°a cÃ³ báº£n ghi payment (nhÆ° thanh toÃ¡n VÃ­)
        .innerJoin('b.slot', 's')
        .innerJoin('s.parkingZone', 'z')
        .innerJoin('z.parkingFloor', 'f')
        .innerJoin('f.parkingLot', 'l')
        .innerJoin('l.owner', 'owner')
        .where('owner.id = :ownerId', { ownerId })
        .andWhere('i.status = :status', { status: InvoiceStatus.PAID })
        .andWhere('i.createdAt BETWEEN :start AND :end', { start, end });

      if (lotId) {
        query.andWhere('l.id = :lotId', { lotId });
      }

      const rawData = await query
        .select("COALESCE(p.method, 'WALLET')", 'method') // Máº·c Ä‘á»‹nh lÃ  WALLET náº¿u khÃ´ng cÃ³ báº£n ghi payment
        .addSelect('COUNT(DISTINCT i.id)', 'count')
        .addSelect('SUM(i.total)', 'total')
        .groupBy("COALESCE(p.method, 'WALLET')")
        .getRawMany();

      return rawData.map((row) => ({
        name: row.method,
        value: parseFloat(row.total) || 0,
        count: parseInt(row.count, 10) || 0,
      }));
    } catch (error) {
      if (error instanceof Error) {
        console.error('Error fetching payment method stats:', error.message);
      } else {
        console.error('An unexpected error occurred:', error);
      }
      return [];
    }
  }

  async getHourlyTraffic(ownerId: string, lotId?: number, dateStr?: string) {
    const queryDate = dateStr ? new Date(dateStr) : new Date();
    const startOfDay = dayjs(queryDate).startOf('day').toDate();
    const endOfDay = dayjs(queryDate).endOf('day').toDate();

    const query = this.bookingRepository
      .createQueryBuilder('b')
      .leftJoin('b.invoice', 'i')
      .innerJoin('b.slot', 's')
      .innerJoin('s.parkingZone', 'z')
      .innerJoin('z.parkingFloor', 'f')
      .innerJoin('f.parkingLot', 'l')
      .innerJoin('l.owner', 'owner')
      .where('owner.id = :ownerId', { ownerId })
      .andWhere('b.start_time >= :start AND b.start_time <= :end', {
        start: startOfDay,
        end: endOfDay,
      })
      // Thá»‘ng kÃª cáº£ nhá»¯ng Ä‘Æ¡n Ä‘ang hoáº¡t Ä‘á»™ng
      .andWhere('b.status IN (:...statuses)', {
        statuses: [
          BookingStatus.CONFIRMED,
          BookingStatus.ONGOING,
          BookingStatus.COMPLETED,
        ],
      });

    if (lotId) {
      query.andWhere('l.id = :lotId', { lotId });
    }

    const rawData = await query
      .select('EXTRACT(HOUR FROM b.start_time)', 'hour')
      .addSelect('COUNT(b.id)', 'count')
      .groupBy('EXTRACT(HOUR FROM b.start_time)')
      .getRawMany();

    const hourlyStats = Array.from({ length: 24 }, (_, i) => ({
      time: `${String(i).padStart(2, '0')}:00`,
      vehicles: 0,
    }));

    rawData.forEach((row) => {
      const hour = Math.floor(parseFloat(row.hour));
      if (hour >= 0 && hour < 24) {
        hourlyStats[hour].vehicles = parseInt(row.count, 10) || 0;
      }
    });

    return hourlyStats;
  }

  async getTopParkingLots(ownerId: string) {
    const rawData = await this.bookingRepository
      .createQueryBuilder('b')
      .leftJoin('b.invoice', 'i')
      .innerJoin('b.slot', 's')
      .innerJoin('s.parkingZone', 'z')
      .innerJoin('z.parkingFloor', 'f')
      .innerJoin('f.parkingLot', 'l')
      .innerJoin('l.owner', 'owner')
      .where('owner.id = :ownerId', { ownerId })
      // Thá»‘ng kÃª top bÃ£i xe dá»±a trÃªn táº¥t cáº£ Ä‘Æ¡n Ä‘áº·t
      .andWhere('b.status IN (:...statuses)', {
        statuses: [
          BookingStatus.CONFIRMED,
          BookingStatus.ONGOING,
          BookingStatus.COMPLETED,
        ],
      })
      .select('l.id', 'lotId')
      .addSelect('l.name', 'name')
      .addSelect('SUM(COALESCE(i.total, 0))', 'revenue')
      .addSelect('COUNT(DISTINCT b.id)', 'bookings')
      // ThÃªm subquery Ä‘á»ƒ tÃ­nh tá»‰ lá»‡ láº¥p Ä‘áº§y thá»±c táº¿ cho tá»«ng bÃ£i
      .addSelect(
        `(SELECT (COUNT(s2.id) FILTER (WHERE s2.status = 'OCCUPIED'))::float / NULLIF(COUNT(s2.id), 0) * 100 
          FROM parking_slots s2 
          JOIN parking_zones z2 ON z2.id = s2.parking_zone_id 
          JOIN parking_floors f2 ON f2.id = z2.parking_floor_id 
          WHERE f2.parking_lot_id = l.id)`,
        'occupancy_rate',
      )
      .groupBy('l.id')
      .addGroupBy('l.name')
      .orderBy('SUM(COALESCE(i.total, 0))', 'DESC')
      .limit(5)
      .getRawMany();

    return rawData.map((row) => ({
      id: row.lotId,
      name: row.name,
      totalRevenue: parseFloat(row.revenue) || 0,
      bookings: parseInt(row.bookings, 10) || 0,
      occupancyRate: parseFloat(row.occupancy_rate) || 0,
    }));
  }

  async getRecentTransactions(ownerId: string, lotId?: number, limit = 5) {
    const query = this.bookingRepository
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.user', 'u')
      .leftJoinAndSelect('u.profile', 'p')
      .leftJoinAndSelect('b.invoice', 'i')
      .leftJoinAndSelect('i.payment', 'pay') // Join payment to get method
      .leftJoinAndSelect('b.slot', 's')
      .leftJoin('s.parkingZone', 'z')
      .leftJoin('z.parkingFloor', 'f')
      .leftJoin('f.parkingLot', 'l')
      .leftJoin('l.owner', 'owner')
      .where('owner.id = :ownerId', { ownerId })
      .andWhere('i.status = :status', { status: InvoiceStatus.PAID });

    if (lotId) {
      query.andWhere('l.id = :lotId', { lotId });
    }

    query.orderBy('i.createdAt', 'DESC').limit(limit);

    const bookings = await query.getMany();

    return bookings.map((b) => {
      const mainInvoice = b.invoice?.[0];
      const mainPayment = mainInvoice?.payment?.[0];

      return {
        id: b.id,
        customerName: b.user?.profile?.name || b.user?.email || 'Guest',
        amount: mainInvoice?.total || 0,
        date: mainInvoice?.createdAt || b.start_time,
        status: mainInvoice?.status,
        method: mainPayment?.method || 'WALLET', // Return the actual method
        slotCode: b.slot?.code,
      };
    });
  }

  // =========== Äáº¿m sÃ´ lÆ°á»£ng booking cá»§a 1 user ================
  async countBookingsByUserId(userId: string) {
    return this.bookingRepository.count({
      where: {
        user: { id: userId },
      },
    });
  }

  // =========== TÃ­nh tá»•ng chi tiÃªu cá»§a 1 user ================
  async calculateTotalSpendingByUserId(userId: string) {
    const result = await this.bookingRepository
      .createQueryBuilder('booking')
      .leftJoin('booking.invoice', 'invoice')
      .leftJoin('booking.user', 'user')
      .where('user.id = :userId', { userId })
      .andWhere('invoice.status = :status', { status: InvoiceStatus.PAID })
      .select('SUM(invoice.total)', 'total')
      .getRawOne();

    return parseFloat(result.total) || 0;
  }

  // =========== Tá»•ng doanh thu booking cá»§a 1 bÃ£i Ä‘á»— xe ================
  async calculateTotalRevenueByOwnerId(ownerId: string) {
    const result = await this.bookingRepository
      .createQueryBuilder('booking')
      .leftJoin('booking.invoice', 'invoice')
      .leftJoin('booking.slot', 'slot')
      .leftJoin('slot.parkingZone', 'zone')
      .leftJoin('zone.parkingFloor', 'floor')
      .leftJoin('floor.parkingLot', 'parkingLot')
      .leftJoin('parkingLot.owner', 'owner')
      .where('owner.id = :ownerId', { ownerId })
      .andWhere('invoice.status = :status', { status: InvoiceStatus.PAID })
      .select('SUM(invoice.total)', 'total')
      .getRawOne();

    const rawTotal = parseFloat(result.total) || 0;
    return this.formatToMillions(rawTotal);
  }

  // =========== ThÃªm má»™t hÃ m helper nhá» trong cÃ¹ng class Ä‘á»ƒ tÃ¡i sá»­ dá»¥ng
  private formatToMillions(amount: number): string {
    if (amount === 0) return '0 Tr â‚«';

    // Chia cho 1 triá»‡u Ä‘á»ƒ láº¥y pháº§n nguyÃªn vÃ  tháº­p phÃ¢n (VD: 5200000 -> 5.2)
    const millions = amount / 1000000;

    // DÃ¹ng Intl.NumberFormat vá»›i locale 'vi-VN' Ä‘á»ƒ tá»± Ä‘á»™ng dÃ¹ng dáº¥u pháº©y `,`
    const formattedNumber = new Intl.NumberFormat('vi-VN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1, // Láº¥y tá»‘i Ä‘a 1 chá»¯ sá»‘ tháº­p phÃ¢n giá»‘ng trong áº£nh
    }).format(millions);

    return `${formattedNumber} Tr â‚«`;
  }

  // =========== Äáº¿m sá»‘ lÆ°á»£ng booking cá»§a 1 bÃ£i Ä‘á»— xe ================
  async countBookingsByOwnerId(ownerId: string) {
    return this.bookingRepository
      .createQueryBuilder('booking')
      .leftJoin('booking.slot', 'slot')
      .leftJoin('slot.parkingZone', 'zone')
      .leftJoin('zone.parkingFloor', 'floor')
      .leftJoin('floor.parkingLot', 'parkingLot')
      .leftJoin('parkingLot.owner', 'owner')
      .where('owner.id = :ownerId', { ownerId })
      .getCount();
  }

  async getOwnerBookingStatsByOwnerIds(ownerIds: string[]) {
    if (!ownerIds.length) {
      return new Map<string, { totalBookings: number; totalRevenue: string }>();
    }

    const rows = await this.bookingRepository
      .createQueryBuilder('booking')
      .leftJoin('booking.slot', 'slot')
      .leftJoin('slot.parkingZone', 'zone')
      .leftJoin('zone.parkingFloor', 'floor')
      .leftJoin('floor.parkingLot', 'parkingLot')
      .leftJoin('parkingLot.owner', 'owner')
      .leftJoin('booking.invoice', 'invoice')
      .where('owner.id IN (:...ownerIds)', { ownerIds })
      .select('owner.id', 'ownerId')
      .addSelect('COUNT(DISTINCT booking.id)', 'totalBookings')
      .addSelect(
        `COALESCE(SUM(CASE WHEN invoice.status = :paidStatus THEN invoice.total ELSE 0 END), 0)`,
        'totalRevenue',
      )
      .setParameter('paidStatus', InvoiceStatus.PAID)
      .groupBy('owner.id')
      .getRawMany();

    return new Map<string, { totalBookings: number; totalRevenue: string }>(
      rows.map((row) => [
        row.ownerId,
        {
          totalBookings: Number(row.totalBookings) || 0,
          totalRevenue: this.formatToMillions(Number(row.totalRevenue) || 0),
        },
      ]),
    );
  }

  //lá»‹ch sá»­ check-in check-out
  async getLiveHistory(
    parkingLotId: number,
    page = 1,
    limit = 10,
    range: '24H' | '7D' | 'MONTH' | 'CUSTOM' = '24H',
    plateNumber?: string,
    startDate?: string,
    endDate?: string,
  ) {
    const query = this.checkLogRepository
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.booking', 'booking')
      .leftJoinAndSelect('log.gate', 'gate')
      .leftJoinAndSelect('booking.vehicle', 'vehicle')
      .where('gate.parking_lot_id = :parkingLotId', { parkingLotId });

    // Handle Time Range
    let start: Date | null = null;
    let end: Date = new Date();

    if (range === '24H') {
      start = new Date(Date.now() - 24 * 60 * 60 * 1000);
    } else if (range === '7D') {
      start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    } else if (range === 'MONTH') {
      start = new Date();
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
    } else if (range === 'CUSTOM' && startDate) {
      start = new Date(startDate);
      if (endDate) end = new Date(endDate);
    }

    if (start) {
      query.andWhere('log.time BETWEEN :start AND :end', { start, end });
    }

    // Handle Plate Number
    if (plateNumber) {
      query.andWhere('vehicle.plate_number ILIKE :plate', {
        plate: `%${plateNumber}%`,
      });
    }

    const [data, count] = await query
      .orderBy('log.time', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { data, count };
  }

  // ================= UTILS: TÃNH PHÃ QUÃ Háº N =================
  private calculateLatePenalty(
    endTime: Date,
    actualExitTime: Date,
    pricePerHour: number,
    priceDay: number,
  ) {
    const gracePeriodMinutes = 15; //thá»i gian Ã¢n háº­n 15p. náº¿u ra trÆ°á»›c 15p thÃ¬ khÃ´ng tÃ­nh phÃ­
    const end = dayjs(endTime);
    const actual = dayjs(actualExitTime);

    // TÃ­nh tá»•ng sá»‘ phÃºt chÃªnh lá»‡ch
    const diffMinutes = actual.diff(end, 'minute');

    // Náº¿u ra trÆ°á»›c hoáº·c trong thá»i gian Ã¢n háº¡n
    if (diffMinutes <= gracePeriodMinutes) {
      return {
        isLate: false,
        lateMinutes: 0,
        penaltyFee: 0,
      };
    }

    // Náº¿u ra muá»™n hÆ¡n thá»i gian Ã¢n háº¡n
    const lateTime = actual.subtract(gracePeriodMinutes, 'minute');
    const totalHoursLate = lateTime.diff(end, 'hour', true);
    const isSameDay = end.isSame(lateTime, 'day');

    let penaltyFee = 0;
    if (isSameDay) {
      // 1. Trong cÃ¹ng 1 ngÃ y: TÃ­nh theo giá», lÃ m trÃ²n lÃªn
      penaltyFee = Math.ceil(totalHoursLate) * pricePerHour;
    } else {
      // 2. Qua Ä‘Ãªm hoáº·c nhiá»u ngÃ y: TÃ­nh theo ngÃ y
      const numberOfDays = Math.ceil(totalHoursLate / 24);
      penaltyFee = numberOfDays * priceDay;
    }

    return {
      isLate: true,
      lateMinutes: Math.round(totalHoursLate * 60),
      penaltyFee: Math.max(0, Math.round(penaltyFee)),
    };
  }
}
