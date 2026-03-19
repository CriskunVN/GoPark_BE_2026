import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ParkingLot } from './entities/parking-lot.entity';
import { Booking } from '../booking/entities/booking.entity';
import { ParkingLotUserResDto } from './dto/parking-lot-user-res.dto';
import {
  OwnerParkingLotResDto,
  OwnerParkingLotTotalsResDto,
} from './dto/owner-parking-lot-res.dto';

@Injectable()
export class ParkingLotService {
  constructor(
    @InjectRepository(ParkingLot)
    private parkingLotRepository: Repository<ParkingLot>,
    @InjectRepository(Booking)
    private bookingRepository: Repository<Booking>,
  ) {}

  // ─── Get users of a parking lot (with optional search) ───────────────────
  async getUsersByParkingLot(
    parkingLotId: number,
    search?: string,
  ): Promise<ParkingLotUserResDto[]> {
    const parkingLot = await this.parkingLotRepository.findOne({
      where: { id: parkingLotId },
    });
    if (!parkingLot) {
      throw new NotFoundException(
        `Không tìm thấy bãi đỗ xe với ID ${parkingLotId}`,
      );
    }

    // Nếu có keyword search → dùng QueryBuilder tối ưu
    if (search?.trim()) {
      return this.searchUsersByParkingLot(parkingLotId, search.trim());
    }

    // Không có search → trả toàn bộ (logic cũ)
    const bookings = await this.bookingRepository.find({
      where: { parkingLot: { id: parkingLotId } },
      relations: ['user', 'user.profile', 'vehicle'],
    });

    return ParkingLotUserResDto.fromBookings(bookings);
  }

  // ─── Search users by name / phone / plate (QueryBuilder + ILIKE) ───────────
  private async searchUsersByParkingLot(
    parkingLotId: number,
    search: string,
  ): Promise<ParkingLotUserResDto[]> {
    const keyword = `%${search}%`;

    const rows: {
      u_id: string;
      u_email: string;
      p_name: string;
      p_phone: string;
      v_plate_number: string | null;
    }[] = await this.bookingRepository
      .createQueryBuilder('b')
      .innerJoin('b.user', 'u')
      .innerJoin('u.profile', 'p')
      .leftJoin('b.vehicle', 'v')
      .where('b.parkingLot = :parkingLotId', { parkingLotId })
      .andWhere(
        '(p.name ILIKE :kw OR p.phone ILIKE :kw OR v.plate_number ILIKE :kw)',
        { kw: keyword },
      )
      .select([
        'u.id          AS u_id',
        'u.email       AS u_email',
        'p.name        AS p_name',
        'p.phone       AS p_phone',
        'v.plate_number AS v_plate_number',
      ])
      .distinctOn(['u.id'])
      .getRawMany();

    return rows.map((r) => ({
      userId: r.u_id,
      name: r.p_name ?? '',
      email: r.u_email,
      phone: r.p_phone ?? '',
      plateNumber: r.v_plate_number ?? '',
    }));
  }

  // ─── Get all parking lots by owner ─────────────────────────────────────────
  async getParkingLotsByOwner(
    ownerId: string,
  ): Promise<OwnerParkingLotResDto[]> {
    const lots = await this.parkingLotRepository.find({
      where: { owner: { id: ownerId } },
    });
    return OwnerParkingLotResDto.fromEntities(lots);
  }

  // ─── Get totals / stats by owner ───────────────────────────────────────────
  async getTotalsByOwner(
    ownerId: string,
  ): Promise<OwnerParkingLotTotalsResDto> {
    const lots = await this.parkingLotRepository.find({
      where: { owner: { id: ownerId } },
    });
    return OwnerParkingLotTotalsResDto.fromEntities(lots);
  }
}
