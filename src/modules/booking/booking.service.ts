import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';

import { Booking } from './entities/booking.entity';
import { ParkingSlot } from '../parking-lot/entities/parking-slot.entity';
import { QRCode } from './entities/qr-code.entity';
import { CheckLog } from './entities/check-log.entity';

import { CreateBookingDto } from './dto/create.dto';
import { EmailService } from '../auth/email/email.service';

import { v4 as uuidv4 } from 'uuid';
import { ActivityStatus, BookingStatus, InvoiceStatus, SlotStatus } from 'src/common/enums/status.enum';
import { ActivityService } from '../activity/activity.service';
import { ActivityType } from 'src/common/enums/type.enum';

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
  ) {}

  // ================= CREATE BOOKING =================
  async createBooking(bookingdto: CreateBookingDto) {
    try {
      // Dọn dẹp booking quá hạn
      await this.bookingRepository
        .createQueryBuilder()
        .delete()
        .from(Booking)
        .where('status = :status', { status: 'PENDING' })
        .andWhere('created_at < :expiredTime', {
          expiredTime: new Date(Date.now() - 15 * 60 * 1000), // Quá 15 phút
        })
        .execute();

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

      //thanh toán bằng tiền mặt
      if (savedBooking.status === 'PENDING') {
        try {
          // Đợi một chút để DB kịp cập nhật quan hệ hoặc dùng trực tiếp savedBooking.id
          await this.sendEmail(savedBooking.id);
          console.log(`Đã gửi email thành công cho booking tiền mặt: ${savedBooking.id}`);
        } catch (emailError) {
          console.error('Lỗi gửi email tiền mặt:', emailError);
          // Không throw lỗi ở đây để tránh rollback booking đã tạo thành công
        }
      }

      // Activity log
      await this.activityService.logActivity({
        type: ActivityType.BOOKING_NEW,
        content: `Người dùng ${bookingdto.user_id} đã đặt chỗ`,
        status: ActivityStatus.SUCCESS,
        userId: bookingdto.user_id,
        meta: {
          slotId: bookingdto.slot_id,
        },
      });

      // ======= add activity log ==================

      await this.activityService.logActivity({
        type: ActivityType.BOOKING_NEW,
        content: `Người dùng ${bookingdto.user_id} đã đặt chỗ tại bãi #`,
        status: ActivityStatus.SUCCESS,
        userId: bookingdto.user_id,
        meta: {
          slotId: bookingdto.slot_id,
        },
      });

      return {
        ...savedBooking,
        qrCodeContent: qrCode.content, //trả về để app vẽ hình QR
      };
    } catch (error) {
      // In lỗi ra terminal để bạn đọc được nó bị gì
      console.error('LỖI TẠI CREATE_BOOKING:', error);
    }
  }

  // ================= scanQR =================
  async scanQRCode(content: string, gateId: number) {
    const qrCode = await this.qrcodeRepository.findOne({
      where: { content, status: 'active' },
      relations: ['booking', 'booking.slot'],
    });

    if (!qrCode) {
      throw new NotFoundException('Mã QR không hợp lệ hoặc đã được sử dụng');
    }

    const booking = qrCode.booking;

    //check-in
    if(booking.status === BookingStatus.CONFIRMED || booking.status === BookingStatus.PENDING) {
      const isAlreadyPaid = booking.status === BookingStatus.CONFIRMED;
      booking.status = BookingStatus.ONGOING;
      
    const newLog = this.checkLogRepository.create({
      booking: booking,
      gate_id: gateId,  
      check_status: 'in',
      time: new Date(),
    });

    await this.checkLogRepository.save(newLog);
    await this.bookingRepository.save(booking);
    return { message: isAlreadyPaid ?' Đã thu tiền và check-in thành công!':'Check in thành công', 
             type: 'in' };
    }

    //check-out
    if(booking.status === BookingStatus.ONGOING) {
      booking.status = BookingStatus.COMPLETED;
      qrCode.status = "used";

    if(booking.slot) {
      booking.slot.status = SlotStatus.AVAILABLE;
      await this.parkingSlotRepository.save(booking.slot);
    }

    await this.checkLogRepository.save({
      booking,
      gate_id:gateId,
      check_status:'out',
      time:new Date()
    })

    await this.qrcodeRepository.save(qrCode);
    await this.bookingRepository.save(booking);
    return {message:'checkout thành công',type:'out'}
    }
    throw new BadRequestException('trạng thái booking không hợp lệ để thực hiện')
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
        floor_number: booking.parkingLot?.parkingFloor?.[0]?.floor_number,
        floor_zone:
          booking.parkingLot?.parkingFloor?.[0]?.parkingZones?.[0]?.zone_name,
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
