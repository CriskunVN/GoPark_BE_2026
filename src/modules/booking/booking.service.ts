  import {
    BadRequestException,
    Body,
    Injectable,
    NotFoundException,
    Param,
    ValidationPipe,
  } from '@nestjs/common';
  import { InjectRepository } from '@nestjs/typeorm';
  import { Booking } from './entities/booking.entity';
  import { Repository } from 'typeorm';
  import { ParkingSlot } from '../parking-lot/entities/parking-slot.entity';
  import { User } from '../users/entities/user.entity';
  import { Vehicle } from '../users/entities/vehicle.entity';
  import { ParkingLot } from '../parking-lot/entities/parking-lot.entity';
  import { CreateBookingDto } from './dto/create.dto';
  import { Profile } from '../users/entities/profile.entity';
  import { QRCode } from './entities/qr-code.entity';
  import { v4 as uuidv4 } from 'uuid';
  import { CheckLog } from './entities/check-log.entity';
import { EmailService } from '../auth/email/email.service';
import { Code } from 'typeorm/browser';
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
      private checkLogRepository : Repository<CheckLog>,
      
      private readonly emailService : EmailService
    ) {}

    //Booking
    async createBooking(bookingdto: CreateBookingDto) {
      try {
      //dọn dẹp booking quá hạn
        await this.bookingRepository
        .createQueryBuilder()
        .delete()
        .from(Booking)
        .where("status = :status", { status: 'PENDING' })
        .andWhere("created_at < :expiredTime", { 
          expiredTime: new Date(Date.now() - 15 * 60 * 1000) // Quá 60 phút
        })
        .execute();

      const slot = await this.parkingSlotRepository.findOne({
        where: {
          id: bookingdto.slot_id,
        },
      });

      //kiểm tra còn slot không
      if (!slot) {
        throw new NotFoundException('Không tìm thấy chỗ đỗ');
      }

      //kiểm tra trạng thái
      if (slot.status.toLowerCase() == 'booked') {
        throw new BadRequestException('Chỗ này đã được đặt');
      }

      //kiểm tra xem user đã có booking pending nào chưa
      let newbooking = await this.bookingRepository.findOne({
        where : {
          user : {id:bookingdto.user_id},
          status : 'PENDING'
      },
        relations:['qrCode'],
      })

      if (newbooking) {
        // 2. NẾU CÓ: Cập nhật lại thông tin mới vào bản ghi cũ
        newbooking.start_time = bookingdto.start_time;
        newbooking.end_time = bookingdto.end_time;
        newbooking.vehicle = { id: bookingdto.vehicle_id } as any;
        newbooking.parkingLot = { id: bookingdto.parking_lot_id } as any;
        newbooking.slot = { id: bookingdto.slot_id } as any;
        // Cập nhật lại ngày tạo để tính lại thời gian hết hạn 15 phút từ lúc này
        newbooking.created_at = new Date(); 
      }else{

        newbooking = this.bookingRepository.create({
        start_time: bookingdto.start_time,
        end_time: bookingdto.end_time,
        status: bookingdto.status,
        user: { id: bookingdto.user_id },
        vehicle: { id: bookingdto.vehicle_id },
        parkingLot: { id: bookingdto.parking_lot_id },
        slot: { id: bookingdto.slot_id },
      });
      }
      const savedBooking= await this.bookingRepository.save(newbooking);

      //tạo qr
      let qrCode = await this.qrcodeRepository.findOne({
        where: { booking: { id: savedBooking.id } }
      });
      if (!qrCode) {
        qrCode = this.qrcodeRepository.create({
        booking:savedBooking,
        content:`PARK-${uuidv4()}`, // Tạo chuỗi ngẫu nhiên duy nhất
        status : 'active'
      })

      await this.qrcodeRepository.save(qrCode)
        } else {
        // Nếu đã có QR rồi, có thể cập nhật nội dung mới nếu muốn, hoặc giữ nguyên
        qrCode.status = 'active'; 
        await this.qrcodeRepository.save(qrCode);
      }
      // // --- GỬI EMAIL TỰ ĐỘNG ---
      // try {
      //   // Gọi hàm sendEmail bạn đã định nghĩa ở dưới
      //   // Lưu ý: Nên dùng setTimeout hoặc Background Job nếu muốn API phản hồi nhanh hơn
      //   await this.sendEmail(savedBooking.id); 
      //   console.log(`Email QR đã được gửi cho booking: ${savedBooking.id}`);
      // } catch (emailError) {
      //   // Không throw lỗi ở đây để tránh làm hỏng giao dịch đặt chỗ nếu chỉ lỗi email
      //   console.error('Lỗi gửi email nhưng đặt chỗ vẫn thành công:', emailError);
      // }

      return {
        ...savedBooking,
        qrCodeContent:qrCode.content//trả về để app vẽ hình QR
      }
      } catch (error) {
      // In lỗi ra terminal để bạn đọc được nó bị gì
      console.error("LỖI TẠI CREATE_BOOKING:", error); 
      
    }
    }

    async scanQRCode(content: string, gateId: number) {
      // 1. Tìm QR Code dựa trên nội dung quét được
      const qrCode = await this.qrcodeRepository.findOne({
        where: { content, status: 'active' },
        relations: ['booking', 'booking.slot'], // Lấy luôn thông tin đặt chỗ và chỗ đỗ
      });

      if (!qrCode) {
        throw new NotFoundException('Mã QR không hợp lệ hoặc đã được sử dụng');
      }

      const booking = qrCode.booking;

      // 2. Xác định xem là khách đang VÀO hay RA
      // Logic đơn giản: Nếu chưa có log nào thì là IN, đã có 1 log IN rồi thì lần này là OUT
      const previousLogs = await this.checkLogRepository.find({
        where: { booking: { id: booking.id } }
      });

      const statusType = previousLogs.length === 0 ? 'in' : 'out';

      // 3. Ghi nhật ký vào CheckLog
      const newLog = this.checkLogRepository.create({
        booking: booking,
        gate_id: gateId,
        check_status: statusType,
        time: new Date(),
      });
      const savedLog = await this.checkLogRepository.save(newLog);
      console.log('Đã lưu log thành công vào DB:', savedLog);
      
      // 4. Cập nhật trạng thái Booking & Slot (Nếu cần)
      if (statusType === 'in') {
        booking.status = 'ongoing'; // Đang đỗ
      } else {
        booking.status = 'completed'; // Đã xong
        qrCode.status = 'used'; // Vô hiệu hóa mã QR sau khi ra
        await this.qrcodeRepository.save(qrCode);
      }
      
      await this.bookingRepository.save(booking);

      return {
        message: `Check-${statusType} thành công!`,
        bookingId: booking.id,
        type: statusType
      };
    }

    getAllBooking() {
      return this.bookingRepository.find({
        select: {
          vehicle: {
            plate_number: true,
            type: true,
          },
          user: {
            id: true,
            profile: {
              id: true,
              name: true,
            },
          },
          parkingLot: {
            name: true,
            address: true,
          },
          invoice: {
            id: true,
            total: true,
          },
        },
        relations: [
          'user',
          'user.profile',
          'vehicle',
          'slot',
          'parkingLot',
          'invoice',
        ], //tên các trường trong database-ko phải tên database
      });
    }

    getBookingByUser(userid: string) {
      {
        return this.bookingRepository.find({
          where: {
            user: {
              id: userid,
            },
          },
          select: {
            user: {
              id: true,
              email:true,
              profile: {
                id: true,
                name: true,
              },
            },
            vehicle: {
              plate_number: true,
              type: true,
            },
            parkingLot: {
              id:true,
              name: true,
              address: true,
              parkingFloor :{
                id:true,
                floor_name:true,
                floor_number:true,
                parkingZone: {
                  id:true,
                  zone_name : true
                }
              }

            },
            invoice: {
              total: true,
            },
          },

          relations: ['user','qrCode', 'slot', 'parkingLot', 'vehicle', 'user.profile','invoice',
            'parkingLot.parkingFloor','parkingLot.parkingFloor.parkingZone'],
          order : {
            id:'DESC'
          }
        });
      }
    }

    async updateBooking(id: number, bookingdto) {
      const updateData: any = {};

      // Map DTO fields to entity properties
      if (bookingdto.start_time) updateData.start_time = bookingdto.start_time;
      if (bookingdto.end_time) updateData.end_time = bookingdto.end_time;
      if (bookingdto.status) updateData.status = bookingdto.status;
      if (bookingdto.user_id) updateData.user = { id: bookingdto.user_id };
      if (bookingdto.vehicle_id)
        updateData.vehicle = { id: bookingdto.vehicle_id };
      if (bookingdto.parking_lot_id)
        updateData.parkingLot = { id: bookingdto.parking_lot_id };
      if (bookingdto.slot_id) updateData.slot = { id: bookingdto.slot_id };

      await this.bookingRepository.update(id, updateData);
      return await this.bookingRepository.findOneBy({ id });
    }

    async deleteBooking(id: number) {
      const deleteBooking = await this.bookingRepository.findOneBy({ id });
      await this.bookingRepository.delete(id);
      if (!deleteBooking) {
        throw new NotFoundException('không có booking');
      } else {
        return deleteBooking;
      }
    }

    //qr-code
    async createQRcode(qrcodedto) {
      const checkqrcode = await this.qrcodeRepository.findOne({
        where: {
          booking: { id: qrcodedto.booking_id },
        },
      });

      if (checkqrcode) {
        throw new BadRequestException('đã có qr cho booking này');
      }
      const newQRcode = await this.qrcodeRepository.create({
        booking: { id: qrcodedto.booking_id },
        content: qrcodedto.content,
        status: qrcodedto.status,
      });
      return await this.qrcodeRepository.save(newQRcode);
    }

    getAllQRcode() {
      return this.qrcodeRepository.find({
        relations: ['booking'],
      });
    }
    
    //send email QR
    async sendEmail(bookingId : number){
      const booking = await this.bookingRepository.findOne({
        where : {id:bookingId},
        relations:['user','user.profile','parkingLot','qrCode', 'vehicle',
            'parkingLot.parkingFloor','parkingLot.parkingFloor.parkingZone','slot']
      })
      console.log(booking)
      if(!booking) throw new NotFoundException("không tìm thấy booking");
      
      const displayName = booking.user.profile.name;
  
      return await this.emailService.sendBookingQREmail(
        booking.user.email,
        displayName,
        {
          qrContent: booking.qrCode.content,
          parkingLot: booking.parkingLot?.name,
          endTime:new Date(booking.end_time).toLocaleString('vi-VN'),
          code:booking.slot.code,
          floor_number:booking.parkingLot.parkingFloor[0].floor_number,
          floor_zone:booking.parkingLot.parkingFloor[0].parkingZone[0].zone_name,
          startTime: new Date(booking.start_time).toLocaleString('vi-VN'),
        }
      );
    }
  }
