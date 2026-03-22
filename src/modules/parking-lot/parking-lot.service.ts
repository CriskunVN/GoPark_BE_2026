import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ParkingLot } from './entities/parking-lot.entity';
import { Booking } from '../booking/entities/booking.entity';
import { ParkingLotUserResDto } from './dto/parking-lot-user-res.dto';
import {
  OwnerParkingLotResDto,
  OwnerParkingLotTotalsResDto,
} from './dto/owner-parking-lot-res.dto';
import { CreateParkingLotReqDto } from './dto/create-parking-lot-req.dto';
import { ParkingLotStatus } from 'src/common/enums/status.enum';
import { RequestService } from '../request/request.service';
import { RequestType } from '../request/entities/request.entity';
import { BecomeOwnerDto } from './dto/become-owner.dto';
import { UsersService } from '../users/users.service';
import { ParkingSlot } from './entities/parking-slot.entity';

@Injectable()
export class ParkingLotService {
  constructor(
    @InjectRepository(ParkingLot)
    private parkingLotRepository: Repository<ParkingLot>,
    @InjectRepository(Booking)
    private bookingRepository: Repository<Booking>,

    @InjectRepository(ParkingSlot)
    private parkingSlotRepository: Repository<ParkingSlot>,

    private requestService: RequestService,

    private usersService: UsersService,
  ) {}

  async createParkingLot(createParkingLotDto: CreateParkingLotReqDto) {
    const parkingLot = this.parkingLotRepository.create({
      name: createParkingLotDto.name,
      address: createParkingLotDto.address,
      lat: createParkingLotDto.lat,
      lng: createParkingLotDto.lng,
      total_slots: createParkingLotDto.totalSlots,
      available_slots:
        createParkingLotDto.availableSlots ?? createParkingLotDto.totalSlots,
      status: ParkingLotStatus.INACTIVE,
      owner: { id: createParkingLotDto.ownerId } as any,
    });

    const savedParkingLot = await this.parkingLotRepository.save(parkingLot);

    // Tạo request để admin duyệt sau khi tạo bãi đỗ xe mới
    await this.requestService.create({
      type: RequestType.NEW_PARKING_LOT,
      payload: {
        parkingLotId: savedParkingLot.id,
        address: savedParkingLot.address,
        name: savedParkingLot.name,
        lat: savedParkingLot.lat,
        lng: savedParkingLot.lng,
        totalSlots: savedParkingLot.total_slots,
        availableSlots: savedParkingLot.available_slots,
      },
      description: `Yêu cầu tạo bãi đỗ xe mới: ${savedParkingLot.name}`,
      requesterId: createParkingLotDto.ownerId,
    });

    return OwnerParkingLotResDto.fromEntity(savedParkingLot);
  }

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

  //   Cho phép người dùng trở thành chủ sở hữu của một bãi đậu xe mới.
  // 1. Kiểm tra xem người dùng có tồn tại hay không. Nếu không, trả về lỗi BadRequestException.
  // 2. Cập nhật số điện thoại của người dùng nếu họ chưa có thông tin này trong hồ sơ của mình.
  async becomeOwner(
    userId: string,
    dto: BecomeOwnerDto,
    files?: Array<Express.Multer.File>,
  ) {
    const user = await this.usersService.findOne(userId);
    if (!user) throw new BadRequestException('User not found');

    if (user.profile && !user.profile.phone) {
      user.profile.phone = dto.phone;
      await this.usersService.update(userId, { profile: user.profile } as any);
    }

    let parsedFloorSlots = []; // Mặc định là mảng rỗng nếu không có hoặc không thể phân tích được
    try {
      if (typeof dto.floorSlots === 'string') {
        parsedFloorSlots = JSON.parse(dto.floorSlots);
      } else {
        parsedFloorSlots = dto.floorSlots;
      }
    } catch {
      parsedFloorSlots = [];
    }

    let totalSlots = 0;
    // 3. Tạo một bản ghi mới trong bảng ParkingLot với trạng thái "PENDING" và liên kết nó với người dùng.
    const parkingLot = this.parkingLotRepository.create({
      name: dto.parkingLotName,
      address: dto.address,
      lat: Number(dto.lat),
      lng: Number(dto.lng),
      status: 'PENDING',
      owner: user,
    });
    // 4. Dựa trên thông tin về số lượng chỗ đậu xe trên mỗi tầng (được cung cấp trong dto.floorSlots), tạo các bản ghi tương ứng trong bảng ParkingSlot và liên kết chúng với bãi đậu xe mới tạo.
    const savedParking = await this.parkingLotRepository.save(parkingLot);

    const slotsToSave: ParkingSlot[] = [];
    parsedFloorSlots.forEach((slotConfig: any, index: number) => {
      const numSlots = Number(slotConfig.capacity || slotConfig || 0);
      const floorIdx = slotConfig.floorNumber
        ? Number(slotConfig.floorNumber) - 1
        : index;
      for (let i = 1; i <= numSlots; i++) {
        totalSlots++;
        slotsToSave.push(
          this.parkingSlotRepository.create({
            parkingLot: savedParking,
            code: `F${floorIdx + 1}-${i}`,
            type: 'REGULAR',
            status: 'AVAILABLE',
          }),
        );
      }
    });
    // 5. Cập nhật tổng số chỗ đậu xe và số chỗ đậu xe còn trống trong bản ghi ParkingLot dựa trên thông tin đã tạo.
    if (slotsToSave.length > 0) {
      await this.parkingSlotRepository.save(slotsToSave);
    }

    savedParking.total_slots = totalSlots;
    savedParking.available_slots = totalSlots;
    await this.parkingLotRepository.save(savedParking);

    const businessLicenseFile = files?.find(
      (f) => f.fieldname === 'businessLicense',
    );
    const businessLicenseUrl: string | null = businessLicenseFile
      ? `uploads/${businessLicenseFile.originalname}`
      : null;

    const ownerRequest = this.requestService.create({
      type: RequestType.BECOME_OWNER,
      description: dto.description,
      payload: {
        businessLicense: businessLicenseUrl,
        taxCode: dto.taxCode,
        parkingLotId: savedParking.id,
      },
      requesterId: user.id,
    });

    await this.usersService.makeOwner(userId);

    return {
      message: 'Created parking lot successfully & owner request submitted',
      data: {
        parkingLot: OwnerParkingLotResDto.fromEntity(savedParking),
        ownerRequest,
      },
    };
  }
}
