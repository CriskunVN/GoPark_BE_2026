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

@Injectable()
export class BookingService {
  constructor(
    @InjectRepository(Booking)
    private bookingRepository: Repository<Booking>,
    @InjectRepository(ParkingSlot)
    private parkingSlotRepository: Repository<ParkingSlot>,
    @InjectRepository(QRCode)
    private qrcodeRepository: Repository<QRCode>,
  ) {}

  //Booking
  async createBooking(bookingdto: CreateBookingDto) {
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
    if (slot.status.toLowerCase() == 'available') {
      throw new BadRequestException('Chỗ này đang bảo trì');
    }

    // const overlap = await this.bookingRepository
    // .createQueryBuilder('booking')
    // .where('booking.slot_id = :slotId', { slotId: booking.slot_id })
    // .andWhere('booking.status IN (:...status)', {
    //     status: ['pending', 'booking'],
    // })
    // .andWhere(
    //     '(booking.start_time < :end AND booking.end_time > :start)',
    //     {
    //     start: booking.start_time,
    //     end: booking.end_time,
    //     },
    // )
    // .getOne();//getOne:nếu trùng trong bảng

    // if(overlap){
    // throw new BadRequestException("Chỗ này đã được đặt trong thời gian này");
    // }

    const newBooking = this.bookingRepository.create({
      start_time: bookingdto.start_time,
      end_time: bookingdto.end_time,
      status: bookingdto.status,

      user: { id: bookingdto.user_id },
      vehicle: { id: bookingdto.vehicle_id },
      parkingLot: { id: bookingdto.parking_lot_id },
      slot: { id: bookingdto.slot_id },
    });
    await this.bookingRepository.save(newBooking);
    console.log(newBooking);
    return newBooking;
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
            name: true,
            address: true,
          },
          invoice: {
            total: true,
          },
        },

        relations: ['user', 'slot', 'parkingLot', 'vehicle', 'user.profile'],
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
}
