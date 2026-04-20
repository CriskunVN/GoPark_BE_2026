import {
  BadRequestException,
  Injectable,
  NotFoundException,
  forwardRef, Inject
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import dayjs from 'dayjs';
import { Between, Repository } from 'typeorm';

import { Booking } from './entities/booking.entity';
import { ParkingSlot } from '../parking-lot/entities/parking-slot.entity';
import { QRCode } from './entities/qr-code.entity';
import { CheckLog } from './entities/check-log.entity';

import { CreateBookingDto } from './dto/create.dto';
import { EmailService } from '../auth/email/email.service';

import { v4 as uuidv4 } from 'uuid';
import {
  ActivityStatus,
  BookingStatus,
  InvoiceStatus,
  SlotStatus,
} from 'src/common/enums/status.enum';
import { ActivityService } from '../activity/activity.service';
import { ActivityType } from 'src/common/enums/type.enum';
import { Gate } from '../parking-lot/entities/gate.entity';
import { DataSource } from 'typeorm';
import { WalletService } from '../wallet/wallet.service';
import { Invoice } from '../payment/entities/invoice.entity';
import { PricingRule } from '../payment/entities/pricingrule.entity';


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

    private dataSource: DataSource,

    @Inject(forwardRef(() => WalletService)) 
    private walletService: WalletService,
  ) {}

  // ================= CREATE BOOKING =================
  async createBooking(bookingdto: CreateBookingDto) {
    try {
      //1. Dọn dẹp booking quá hạn (Cần await để tránh race condition xóa nhầm bản ghi đang xử lý)
      await this.bookingRepository
        .createQueryBuilder()
        .delete()
        .from(Booking)
        .where('status = :status', { status: 'PENDING' })
        .andWhere('created_at < :expiredTime', {
          expiredTime: new Date(Date.now() - 2 * 60 * 1000),
        })
        .execute();

      //2. kiểm tra xe có đang bận ở vị trí khác không
        const startTime = new Date(bookingdto.start_time);
        const endTime = new Date(bookingdto.end_time);
        
        const conflictingVehicle = await this.bookingRepository
        .createQueryBuilder('booking')
        .where('booking.vehicle = :vehicleId', { vehicleId: bookingdto.vehicle_id })
        // Chỉ check các booking "sống": Đã thanh toán, đang đỗ, hoặc đang chờ thanh toán
        .andWhere('booking.status IN (:...statuses)', {
          statuses: [BookingStatus.PENDING, BookingStatus.CONFIRMED, BookingStatus.ONGOING],
        })
        // Công thức overlap: (Start1 < End2) AND (End1 > Start2)
        .andWhere('booking.start_time < :endTime', { endTime })
        .andWhere('booking.end_time > :startTime', { startTime })
        .getOne();

      if (conflictingVehicle) {
        throw new BadRequestException(
        `Xe này đã có lịch đặt chỗ trong khoảng thời gian từ ${dayjs(conflictingVehicle.start_time).format('HH:mm')} đến ${dayjs(conflictingVehicle.end_time).format('HH:mm')}`
        );
      }
      


      const slot = await this.parkingSlotRepository.findOne({
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
      let newbooking = await this.bookingRepository.findOne({
        where: {
          user: { id: bookingdto.user_id },
          status: BookingStatus.PENDING,
        },
        relations: ['qrCode'],
      });

      if (newbooking) {
        // NẾU CÓ: Cập nhật lại thông tin mới vào bản ghi cũ
        newbooking.start_time = new Date(bookingdto.start_time);
        newbooking.end_time = new Date(bookingdto.end_time);
        newbooking.vehicle = { id: bookingdto.vehicle_id } as any;
        newbooking.slot = { id: bookingdto.slot_id } as any;
        newbooking.created_at = new Date();
      } else {
        newbooking = this.bookingRepository.create({
          start_time: bookingdto.start_time,
          end_time: bookingdto.end_time,
          status: BookingStatus.PENDING,
          user: { id: bookingdto.user_id },
          vehicle: { id: bookingdto.vehicle_id },
          slot: { id: bookingdto.slot_id },
        });
      }
      const savedBooking = await this.bookingRepository.save(newbooking);

      // Tạo QR
      let qrCode = await this.qrcodeRepository.findOne({
        where: { booking: { id: savedBooking.id } },
      });

      if (!qrCode) {
        qrCode = this.qrcodeRepository.create({
          booking: savedBooking,
          content: `PARK-${uuidv4()}`, // Tạo chuỗi ngẫu nhiên duy nhất
          status: 'active',
        });

        await this.qrcodeRepository.save(qrCode);
      } else {
        // Nếu đã có QR rồi, có thể cập nhật nội dung mới nếu muốn, hoặc giữ nguyên
        qrCode.status = 'active';
        await this.qrcodeRepository.save(qrCode);
      }

      // Activity log - Bỏ qua await để trả kết quả về FE nhanh hơn
      this.activityService
        .logActivity({
          type: ActivityType.BOOKING_NEW,
          content: `Người dùng ${bookingdto.user_id} đã đặt chỗ thành công`,
          status: ActivityStatus.SUCCESS,
          userId: bookingdto.user_id,
          meta: {
            slotId: bookingdto.slot_id,
          },
        })
        .catch((e) => console.error('Log activity error:', e));

      return {
        ...savedBooking,
        qrCodeContent: qrCode.content, //trả về để app vẽ hình QR
      };
    } catch (error) {
      // In lỗi ra terminal để bạn đọc được nó bị gì
      console.error('LỖI TẠI CREATE_BOOKING:', error);
      throw error; // Phải throw lỗi để NestJS trả về HTTP 500/400 cho Frontend
    }
  }

  // =================  BOOKING (GIA HẠN) =================
  async extendBooking(id: number, extendDto: { new_end_time: string, isPreview?: boolean }, currentUserId?: string) {
    return await this.dataSource.transaction(async (manager) => {
      // 1. Lấy thông tin booking và các quan hệ
      const booking = await manager.findOne(Booking, {
        where: { id },
        relations: [
          'slot', 
          'user', 
          'slot.parkingZone',
          'slot.parkingZone.parkingFloor',
          'slot.parkingZone.parkingFloor.parkingLot',
          'slot.parkingZone.parkingFloor.parkingLot.owner'
        ],
      });

      if (!booking) throw new NotFoundException('Không tìm thấy đơn đặt chỗ');
      
      // SECURITY CHECK: Chỉ chủ nhân đơn hàng mới được gia hạn
      if (currentUserId && booking.user.id !== currentUserId) {
        throw new BadRequestException('Bạn không có quyền gia hạn đơn hàng này');
      }

      // 2. Lấy đơn giá thực tế theo Zone (Khu vực) từ Database
      const pricing = await manager.findOne(PricingRule, {
        where: { parkingZone: { id: booking.slot.parkingZone.id } },
        order: { id: 'DESC' } 
      });

      const pricePerHour = pricing?.price_per_hour || 0;
      const priceDay = pricing?.price_per_day || 0;
      const zoneName = booking.slot.parkingZone.zone_name || 'Khu vực';

      const oldEndTime = dayjs(booking.end_time);
      const newEndTime = dayjs(extendDto.new_end_time);

      if (newEndTime.isBefore(oldEndTime) || newEndTime.isSame(oldEndTime)) {
        throw new BadRequestException('Giờ kết thúc mới phải sau giờ hiện tại');
      }

      // 3. Kiểm tra xung đột Slot
      const conflict = await manager.createQueryBuilder(Booking, 'b')
        .where('b.slot_id = :slotId', { slotId: booking.slot.id })
        .andWhere('b.id != :id', { id })
        .andWhere('b.status IN (:...st)', { st: [BookingStatus.CONFIRMED, BookingStatus.ONGOING] })
        .andWhere('b.start_time < :newEndTime', { newEndTime: newEndTime.toISOString() })
        .andWhere('b.end_time > :oldEndTime', { oldEndTime: oldEndTime.toISOString() })
        .getOne();

      if (conflict) throw new BadRequestException('Vị trí này đã có người đặt trước trong khung giờ bạn muốn gia hạn!');

      // 4. ÁP DỤNG CÔNG THỨC ĐỒNG NHẤT VỚI FRONTEND
      const totalMinutesExtend = newEndTime.diff(oldEndTime, 'minute');
      
      // Tính số ngày và số phút lẻ
      const days = Math.floor(totalMinutesExtend / 1440);
      const remainingMinutes = totalMinutesExtend % 1440;
      
      // Công thức: (Ngày * Giá ngày) + (Phút lẻ * Giá giờ/60)
      const pricePerMin = pricePerHour / 60;
      const extraAmount = Math.round((days * priceDay) + (remainingMinutes * pricePerMin));

      // Trả về Preview cho Dũng hiển thị trên UI
      if (extendDto.isPreview) {
        return { 
          data: { 
            extraAmount: extraAmount > 0 ? extraAmount : 0,
            pricePerHour,
            priceDay,
            zoneName,
            totalMinutesExtend,
            days,
            remainingMinutes
          } 
        };
      }

      // 5. Thanh toán thực tế
      if (extraAmount > 0) {
        // SỬA LỖI: Chuyển tiền từ Khách sang Chủ (không dùng withdraw)
        const ownerId = booking.slot.parkingZone.parkingFloor.parkingLot.owner?.id;
        if (!ownerId) throw new BadRequestException('Không tìm thấy thông tin chủ bãi để thanh toán');
        
        await this.walletService.processPayment(booking.user.id, ownerId, extraAmount, id.toString());

        // Tạo hóa đơn gia hạn
        const invoiceData: any = {
          booking: booking, 
          total: extraAmount,
          tax:0,
          description: `Gia hạn thêm ${days > 0 ? days + ' ngày ' : ''}${remainingMinutes} phút tại ${zoneName}`,
          status: 'PAID',
        };

        const newInvoice = manager.create(Invoice, invoiceData);
        await manager.save(newInvoice);
      }

      // 6. Cập nhật giờ mới vào database
      booking.end_time = newEndTime.toDate();
      const updatedBooking = await manager.save(booking);

      return {
        message: "Gia hạn thành công",
        data: updatedBooking
      };
    });
  }

  // ================= scanQR =================
  async scanQRCode(content: string, gateId: number, detectedPlate?: string) {
    // 1. Kiểm tra cổng
    const gate = await this.checkLogRepository.manager.findOne(Gate, { where: { id: gateId } });
    if (!gate) throw new NotFoundException('Cổng không tồn tại');

    // 2. Kiểm tra mã QR
    const qrCode = await this.qrcodeRepository.findOne({
      where: { content, status: 'active' },
      relations: ['booking', 'booking.slot', 'booking.vehicle'],
    });

    if (!qrCode) throw new NotFoundException('Mã QR không hợp lệ hoặc đã sử dụng');

    const booking = qrCode.booking;

    // 3. SO KHỚP BIỂN SỐ XE (ĐÃ TỐI ƯU)
    if (detectedPlate && booking.vehicle) {
      // Bước A: Chuẩn hóa chuỗi thô từ OCR (Viết hoa, xóa dấu cách, gạch ngang, dấu chấm)
      const rawOcr = detectedPlate.toUpperCase().replace(/[\s.-]/g, '');
      const cleanRegistered = booking.vehicle.plate_number.toUpperCase().replace(/[\s.-]/g, '');

      // Bước B: Dùng Regex để tìm cụm ký tự có định dạng biển số VN
      // Định dạng: 2 số đầu - 1 chữ cái + 1 số/chữ - Dãy 4 hoặc 5 số cuối
      const plateRegex = /[0-9]{2}[A-Z][0-9A-Z][0-9]{4,5}/;
      const match = rawOcr.match(plateRegex);

      // Nếu tìm thấy cụm khớp định dạng thì lấy cụm đó, không thì dùng chuỗi gốc để so sánh tiếp
      const cleanDetected = match ? match[0] : rawOcr;

      console.log('Biển số lọc được:', cleanDetected);
      console.log('Biển số trong DB:', cleanRegistered);

      // Bước C: So khớp (Dùng includes để tăng độ chính xác nếu OCR đọc thừa 1-2 ký tự đầu/đuôi)
      if (!cleanDetected.includes(cleanRegistered) && !cleanRegistered.includes(cleanDetected)) {
        throw new BadRequestException(
          `Biển số không khớp! Hệ thống lọc được: ${cleanDetected}, Đăng ký: ${booking.vehicle.plate_number}`,
        );
      }
    } else if (!detectedPlate) {
      throw new BadRequestException('Vui lòng cung cấp ảnh biển số xe để đối chiếu');
    }

    //check-in
    if (
      booking.status === BookingStatus.CONFIRMED ||
      booking.status === BookingStatus.PENDING
    ) {
      // Ràng buộc: Check-in không được phép tại cổng chỉ dành cho lối ra (OUT)
      if (gate.type === 'OUT') {
        throw new BadRequestException(
          `Cổng "${gate.name}" chỉ dành cho lối ra. Vui lòng quét tại cổng lối vào.`,
        );
      }

      const isAlreadyPaid = booking.status === BookingStatus.CONFIRMED;
      booking.status = BookingStatus.ONGOING;

      const newLog = this.checkLogRepository.create({
        booking: booking,
        gate: { id: gateId } as any, // Sử dụng quan hệ gate với ID truyền vào từ mobile/camera
        check_status: 'in',
        time: new Date(),
      });

      await this.checkLogRepository.save(newLog);
      await this.bookingRepository.save(booking);
      return {
        message: isAlreadyPaid
          ? ' Đã thu tiền và check-in thành công!'
          : 'Check in thành công',
        type: 'in',
      };
    }

    //check-out
    if (booking.status === BookingStatus.ONGOING) {
      // Ràng buộc: Check-out không được phép tại cổng chỉ dành cho lối vào (IN)
      if (gate.type === 'IN') {
        throw new BadRequestException(
          `Cổng "${gate.name}" chỉ dành cho lối vào. Vui lòng quét tại cổng lối ra.`,
        );
      }

      booking.status = BookingStatus.COMPLETED;
      qrCode.status = 'used';

      if (booking.slot) {
        booking.slot.status = SlotStatus.AVAILABLE;
        await this.parkingSlotRepository.save(booking.slot);
      }

      const newLog = this.checkLogRepository.create({
        booking: booking,
        gate: { id: gateId } as any, // Lưu vết lại xe ra ở cổng nào
        check_status: 'out',
        time: new Date(),
      });

      await this.checkLogRepository.save(newLog);

      await this.qrcodeRepository.save(qrCode);
      await this.bookingRepository.save(booking);
      return { message: 'checkout thành công', type: 'out' };
    }
    throw new BadRequestException(
      'trạng thái booking không hợp lệ để thực hiện',
    );
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

  // ================= BOOKING BY PARKING LOT =================

  async getBookingByParkingLot(
    lotId: number,
    search?: string,
    startDate?: string,
    endDate?: string,
  ) {
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
      throw new NotFoundException('không có booking');
    }

    await this.bookingRepository.delete(id);

    const userName =
      booking.user?.profile?.name ||
      booking.user?.email ||
      `user #${booking.user?.id ?? 'N/A'}`;
    const parkingLot = booking.slot?.parkingZone?.parkingFloor?.parkingLot;
    const parkingLotName =
      parkingLot?.name || `bãi #${parkingLot?.id ?? 'N/A'}`;

    await this.activityService.logActivity({
      type: ActivityType.BOOKING_CANCELED,
      content: `Người dùng ${userName} đã hủy chỗ tại ${parkingLotName}`,
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
      throw new BadRequestException('đã có qr cho booking này');
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
      throw new NotFoundException('không tìm thấy booking');
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

  // ================== Thống kê số lượng booking hôm nay (ADMIN) =================
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

  // =========== Tính doanh thu trong tháng (ADMIN) ================
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
      .andWhere('i.status = :status', { status: InvoiceStatus.PAID })
      .select('SUM(i.total)', 'total')
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
      .andWhere('i.status = :status', { status: InvoiceStatus.PAID })
      .select('SUM(i.total)', 'total')
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

    return {
      monthlyRevenue,
      lastMonthRevenue,
      growthPercent: parseFloat(growthPercent.toFixed(2)),
      totalBookings,
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
      .andWhere('i.status = :status', { status: InvoiceStatus.PAID })
      .select('EXTRACT(MONTH FROM b.start_time)', 'month')
      .addSelect('SUM(i.total)', 'revenue')
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

  // =========== Đếm sô lượng booking của 1 user ================
  async countBookingsByUserId(userId: string) {
    return this.bookingRepository.count({
      where: {
        user: { id: userId },
      },
    });
  }

  // =========== Tính tổng chi tiêu của 1 user ================
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

  // =========== Tổng doanh thu booking của 1 bãi đỗ xe ================
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

  // =========== Thêm một hàm helper nhỏ trong cùng class để tái sử dụng
  private formatToMillions(amount: number): string {
    if (amount === 0) return '0 Tr ₫';

    // Chia cho 1 triệu để lấy phần nguyên và thập phân (VD: 5200000 -> 5.2)
    const millions = amount / 1000000;

    // Dùng Intl.NumberFormat với locale 'vi-VN' để tự động dùng dấu phẩy `,`
    const formattedNumber = new Intl.NumberFormat('vi-VN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1, // Lấy tối đa 1 chữ số thập phân giống trong ảnh
    }).format(millions);

    return `${formattedNumber} Tr ₫`;
  }

  // =========== Đếm số lượng booking của 1 bãi đỗ xe ================
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
}
