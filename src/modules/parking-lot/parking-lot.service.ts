import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Not } from 'typeorm';
import { ParkingLot } from './entities/parking-lot.entity';
import { Booking } from '../booking/entities/booking.entity';
import { ParkingLotUserResDto } from './dto/parking-lot-user-res.dto';
import {
  OwnerParkingLotResDto,
  OwnerParkingLotTotalsResDto,
} from './dto/owner-parking-lot-res.dto';
import { CreateParkingLotReqDto } from './dto/create-parking-lot-req.dto';
import { ParkingLotStatus, SlotStatus } from 'src/common/enums/status.enum';
import { RequestService } from '../request/request.service';
import { RequestType } from '../request/entities/request.entity';
import { BecomeOwnerDto } from './dto/become-owner.dto';
import { UsersService } from '../users/users.service';
import { ParkingSlot } from './entities/parking-slot.entity';
import { WalkInDto } from './dto/walk-in.dto';
import { User } from '../users/entities/user.entity';
import { Profile } from '../users/entities/profile.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { ParkingFloor } from './entities/parking-floor.entity';
import { ParkingZone } from './entities/parking-zone.entity';
import { CreateFloorDto } from './dto/create-floor.dto';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { Review } from '../users/entities/review.entity';

export interface OcrSpaceResponse {
  IsErroredOnProcessing: boolean;
  ErrorMessage?: string[];
  ParsedResults?: Array<{
    ParsedText: string;
  }>;
}

@Injectable()
export class ParkingLotService {
  constructor(
    @InjectRepository(ParkingLot)
    private parkingLotRepository: Repository<ParkingLot>,
    @InjectRepository(Booking)
    private bookingRepository: Repository<Booking>,

    @InjectRepository(ParkingSlot)
    private parkingSlotRepository: Repository<ParkingSlot>,

    @InjectRepository(Vehicle)
    private vehicleRepository: Repository<Vehicle>,
    @InjectRepository(ParkingFloor)
    private parkingFloorRepository: Repository<ParkingFloor>,

    @InjectRepository(ParkingZone)
    private parkingZoneRepository: Repository<ParkingZone>,
    @InjectRepository(Review)
    private reviewRepository: Repository<Review>,

    private requestService: RequestService,

    private usersService: UsersService,
    private dataSource: DataSource,
  ) {}

  async createParkingLot(createParkingLotDto: CreateParkingLotReqDto) {
    const parkingLot = this.parkingLotRepository.create({
      name: createParkingLotDto.name,
      address: createParkingLotDto.address,
      lat: createParkingLotDto.lat,
      lng: createParkingLotDto.lng,
      total_slots: createParkingLotDto.totalSlots ?? 0,
      available_slots:
        createParkingLotDto.availableSlots ??
        createParkingLotDto.totalSlots ??
        0,
      status: ParkingLotStatus.INACTIVE,
      owner: { id: createParkingLotDto.ownerId } as User,
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
            status: SlotStatus.AVAILABLE,
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

  // ─── Extract License Plate (OCR) ───────────────────────────────────────────
  async extractLicensePlate(file: Express.Multer.File): Promise<string> {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }

    try {
      const apiKey = String(process.env.OCR_API_KEY || 'K88596879988957');
      const base64Image = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;

      const formData = new FormData();
      formData.append('base64Image', base64Image);
      formData.append('apikey', apiKey);
      formData.append('language', 'eng');
      formData.append('OCREngine', '2');

      const response = await fetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        body: formData as unknown as BodyInit,
      });

      const result = (await response.json()) as OcrSpaceResponse;

      if (result.IsErroredOnProcessing) {
        throw new BadRequestException(result.ErrorMessage?.[0] || 'OCR Error');
      }

      const parsedText = String(result.ParsedResults?.[0]?.ParsedText || '');
      return parsedText.trim().replace(/\r?\n|\r/g, ' ');
    } catch (error: unknown) {
      console.error('OCR Error:', error);
      throw new InternalServerErrorException('Failed to extract license plate');
    }
  }

  // ─── Guest Check-in (Walk-in) ──────────────────────────────────────────────
  async handleWalkIn(parkingLotId: number, dto: WalkInDto) {
    const parkingLot = await this.parkingLotRepository.findOne({
      where: { id: parkingLotId },
    });

    if (!parkingLot) {
      throw new NotFoundException('Parking lot not found');
    }

    if (parkingLot.available_slots <= 0) {
      throw new BadRequestException('Parking lot is full');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      let user = await queryRunner.manager
        .createQueryBuilder(User, 'user')
        .innerJoinAndSelect('user.profile', 'profile')
        .where('profile.phone = :phone', { phone: dto.phoneNumber })
        .getOne();

      if (!user) {
        const email = `guest_${dto.phoneNumber}@gopark.local`;
        const randomPassword = Math.random().toString(36).slice(-8);

        const newUser = queryRunner.manager.create(User, {
          email,
          password: randomPassword,
          status: 'ACTIVE',
        });
        user = await queryRunner.manager.save(User, newUser);

        const profile = queryRunner.manager.create(Profile, {
          name: dto.name,
          phone: dto.phoneNumber,
          user: user,
        });
        await queryRunner.manager.save(Profile, profile);
        user.profile = profile;
      }

      const standardizedPlate = dto.licensePlate
        .toUpperCase()
        .replace(/\W/g, '');

      let vehicle = await queryRunner.manager.findOne(Vehicle, {
        where: { plate_number: standardizedPlate },
        relations: ['user'],
      });

      if (!vehicle) {
        vehicle = queryRunner.manager.create(Vehicle, {
          plate_number: standardizedPlate,
          user: user,
        });
        vehicle = await queryRunner.manager.save(Vehicle, vehicle);
      } else {
        // Cập nhật lại user nếu xe đang thuộc về user khác
        if (vehicle.user.id !== user.id) {
          vehicle.user = user;
          vehicle = await queryRunner.manager.save(Vehicle, vehicle);
        }
      }

      const booking = queryRunner.manager.create(Booking, {
        status: 'IN_PROGRESS',
        start_time: new Date(),
        end_time: new Date(), // Set temporary end_time
        parkingLot: parkingLot,
        user: user,
        vehicle: vehicle,
      });
      await queryRunner.manager.save(Booking, booking);

      parkingLot.available_slots -= 1;
      await queryRunner.manager.save(ParkingLot, parkingLot);

      await queryRunner.commitTransaction();

      return {
        message: 'Guest check-in successful',
        bookingId: booking.id,
      };
    } catch (error: unknown) {
      await queryRunner.rollbackTransaction();
      console.error('Walk-in Error:', error);
      if (error instanceof Error) {
        throw new InternalServerErrorException(
          error.message || 'Failed to process walk-in registration',
        );
      }
      throw new InternalServerErrorException(
        'Failed to process walk-in registration',
      );
    } finally {
      await queryRunner.release();
    }
  }

  //Get bãi đỗ
  async getMapForBooking(lotid: number, userId: string) {
    console.log('Getting map for booking - ParkingLotService', {
      lotid,
      userId,
    });
    //lấy thông tin bãi đỗ cùng với các tầng, zone, slot để hiển thị trên map khi booking
    const lot = await this.parkingLotRepository.findOne({
      where: { id: lotid },
      relations: [
        'owner',
        'pricingRule',
        'pricingRule.parkingZone',
        'parkingFloor',
        'parkingFloor.parkingZone',
        'parkingFloor.parkingZone.slot',
      ],
    });

    if (!lot) throw new NotFoundException('Not found Parking Lot');

    //lấy danh sách xe của người dùng
    const vehicleUser = await this.vehicleRepository.find({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    return {
      ...lot,
      userVehicles: vehicleUser,
    };
  }
  // ─── Floor & Zone Management (Customization) ──────────────────────────────

  async getFloorsByParkingLot(lotId: number) {
    return await this.parkingFloorRepository.find({
      where: { parkingLot: { id: lotId } },
      relations: ['parkingZone'],
    });
  }

  async getZonesByFloor(lotId: number, floorId: number) {
    return await this.parkingZoneRepository.find({
      where: {
        parkingFloor: {
          id: floorId,
          parkingLot: { id: lotId },
        },
      },
      relations: ['parkingFloor'],
    });
  }

  async createFloor(lotId: number, dto: CreateFloorDto) {
    const lot = await this.parkingLotRepository.findOne({
      where: { id: lotId },
    });
    if (!lot) throw new NotFoundException('Parking lot not found');

    const floor = this.parkingFloorRepository.create({
      ...dto,
      parkingLot: lot,
    });
    return await this.parkingFloorRepository.save(floor);
  }

  async updateFloor(lotId: number, floorId: number, dto: any) {
    const floor = await this.parkingFloorRepository.findOne({
      where: { id: floorId, parkingLot: { id: lotId } },
    });
    if (!floor) {
      throw new NotFoundException(
        'Parking floor not found or mismatched with parking lot',
      );
    }

    Object.assign(floor, dto);
    return await this.parkingFloorRepository.save(floor);
  }

  async createZone(floorId: number, dto: CreateZoneDto) {
    const floor = await this.parkingFloorRepository.findOne({
      where: { id: floorId },
      relations: ['parkingLot'],
    });
    if (!floor) throw new NotFoundException('Parking floor not found');

    const zone = this.parkingZoneRepository.create({
      ...dto,
      parkingFloor: floor,
    });
    const savedZone = await this.parkingZoneRepository.save(zone);

    // Sync hierarchical totals
    await this.syncHierarchyTotals(floor.id);

    return savedZone;
  }

  async updateZone(
    lotId: number,
    floorId: number,
    zoneId: number,
    dto: UpdateZoneDto,
  ) {
    const zone = await this.parkingZoneRepository.findOne({
      where: {
        id: zoneId,
        parkingFloor: { id: floorId, parkingLot: { id: lotId } },
      },
      relations: ['parkingFloor', 'parkingFloor.parkingLot'],
    });
    if (!zone) {
      throw new NotFoundException(
        'Parking zone not found or mismatched with floor/lot',
      );
    }

    Object.assign(zone, dto);
    const savedZone = await this.parkingZoneRepository.save(zone);

    // Sync hierarchical totals
    await this.syncHierarchyTotals(zone.parkingFloor.id);

    return savedZone;
  }

  private async syncHierarchyTotals(floorId: number) {
    // 1. Update Floor total_slots (dựa trên metadata zone.total_slots)
    const floor = await this.parkingFloorRepository.findOne({
      where: { id: floorId },
      relations: ['parkingZone', 'parkingLot'],
    });

    if (!floor) return;

    const totalFloorSlots = floor.parkingZone.reduce(
      (sum, zone) => sum + (zone.total_slots || 0),
      0,
    );
    floor.total_slots = totalFloorSlots;
    await this.parkingFloorRepository.save(floor);

    // 2. Update ParkingLot total_slots + available_slots từ slot thực tế trong DB
    const lotId = floor.parkingLot.id;
    const lot = await this.parkingLotRepository.findOne({
      where: { id: lotId },
      relations: ['parkingFloor'],
    });

    if (!lot) return;

    const totalLotSlots = lot.parkingFloor.reduce(
      (sum, f) => sum + (f.total_slots || 0),
      0,
    );
    lot.total_slots = totalLotSlots;

    // available_slots = số slot AVAILABLE thực tế trong DB
    const availableCount = await this.parkingSlotRepository.count({
      where: {
        parkingLot: { id: lotId },
        status: SlotStatus.AVAILABLE,
      },
    });
    lot.available_slots = availableCount;

    await this.parkingLotRepository.save(lot);
  }

  // ─── Generate / Sync Slots ────────────────────────────────────────────────

  /**
   * Generate hoặc sync slots cho 1 Zone cụ thể.
   * - total_slots tăng → thêm slot mới AVAILABLE
   * - total_slots giảm → vô hiệu hoá (DISABLED) slot AVAILABLE cuối
   * - total_slots bằng → không làm gì
   */
  async generateSlotsForZone(
    lotId: number,
    floorId: number,
    zoneId: number,
  ): Promise<{ added: number; disabled: number }> {
    // 1. Verify zone thuộc đúng floor & lot
    const zone = await this.parkingZoneRepository.findOne({
      where: {
        id: zoneId,
        parkingFloor: { id: floorId, parkingLot: { id: lotId } },
      },
      relations: ['parkingFloor', 'parkingFloor.parkingLot'],
    });
    if (!zone) {
      throw new NotFoundException(
        'Không tìm thấy zone hoặc zone không thuộc floor/lot này',
      );
    }

    const lot = zone.parkingFloor.parkingLot;
    const floor = zone.parkingFloor;
    const targetCount = zone.total_slots;

    // 2. Lấy tất cả slot ACTIVE (không phải DISABLED) của zone
    const activeSlots = await this.parkingSlotRepository.find({
      where: {
        parkingZone: { id: zoneId },
        status: Not(SlotStatus.DISABLED),
      },
      order: { id: 'ASC' },
    });
    const currentActiveCount = activeSlots.length;

    // CASE C: Bằng nhau → không làm gì
    if (targetCount === currentActiveCount) {
      return { added: 0, disabled: 0 };
    }

    // CASE A: total_slots tăng → thêm slot mới
    if (targetCount > currentActiveCount) {
      const toAdd = targetCount - currentActiveCount;

      // Tính max STT hiện có để tiếp tục đánh số
      const allSlots = await this.parkingSlotRepository.find({
        where: { parkingZone: { id: zoneId } },
        order: { id: 'DESC' },
        take: 1,
      });
      let maxIndex = 0;
      if (allSlots.length > 0) {
        // Trích số cuối từ code VD: "A007" → 7
        const match = allSlots[0].code.match(/(\d+)$/);
        maxIndex = match ? parseInt(match[1], 10) : 0;
      }

      // Dùng prefix từ zone (VD: 'A', 'B', 'VIP') — owner tự đặt khi tạo zone
      const prefix = zone.prefix.toUpperCase();
      const newSlots: ParkingSlot[] = [];
      for (let i = 1; i <= toAdd; i++) {
        const stt = String(maxIndex + i).padStart(3, '0');
        newSlots.push(
          this.parkingSlotRepository.create({
            code: `${prefix}${stt}`,
            status: SlotStatus.AVAILABLE,
            parkingLot: lot,
            parkingFloor: floor,
            parkingZone: zone,
          }),
        );
      }
      await this.parkingSlotRepository.save(newSlots);
      await this.syncHierarchyTotals(floorId);
      return { added: toAdd, disabled: 0 };
    }

    // CASE B: total_slots giảm → vô hiệu hoá slot AVAILABLE cuối
    const toDisable = currentActiveCount - targetCount;

    // Chỉ disable slot AVAILABLE (không được disable OCCUPIED/RESERVED)
    const availableSlots = await this.parkingSlotRepository.find({
      where: {
        parkingZone: { id: zoneId },
        status: SlotStatus.AVAILABLE,
      },
      order: { id: 'DESC' }, // lấy slot mới nhất trước
    });

    if (availableSlots.length < toDisable) {
      throw new BadRequestException(
        `Không thể giảm xuống ${targetCount} slot: ` +
          `có ${currentActiveCount - availableSlots.length} slot đang OCCUPIED/RESERVED, ` +
          `chỉ có thể vô hiệu hoá tối đa ${currentActiveCount - (currentActiveCount - availableSlots.length)} slot.`,
      );
    }

    const slotsToDisable = availableSlots.slice(0, toDisable);
    for (const slot of slotsToDisable) {
      slot.status = SlotStatus.DISABLED;
    }
    await this.parkingSlotRepository.save(slotsToDisable);
    await this.syncHierarchyTotals(floorId);
    return { added: 0, disabled: toDisable };
  }

  /**
   * Generate / sync slots cho tất cả zones của 1 Floor.
   */
  async generateSlotsForFloor(
    lotId: number,
    floorId: number,
  ): Promise<{
    totalAdded: number;
    totalDisabled: number;
    perZone: Array<{
      zoneId: number;
      zoneName: string;
      added: number;
      disabled: number;
    }>;
  }> {
    const zones = await this.parkingZoneRepository.find({
      where: {
        parkingFloor: { id: floorId, parkingLot: { id: lotId } },
      },
    });

    if (zones.length === 0) {
      throw new NotFoundException('Floor không có zone nào');
    }

    let totalAdded = 0;
    let totalDisabled = 0;
    const perZone: Array<{
      zoneId: number;
      zoneName: string;
      added: number;
      disabled: number;
    }> = [];

    for (const zone of zones) {
      const result = await this.generateSlotsForZone(lotId, floorId, zone.id);
      totalAdded += result.added;
      totalDisabled += result.disabled;
      perZone.push({
        zoneId: zone.id,
        zoneName: zone.zone_name,
        added: result.added,
        disabled: result.disabled,
      });
    }

    return { totalAdded, totalDisabled, perZone };
  }

  /**
   * Generate / sync slots cho tất cả floors & zones của 1 Lot.
   * Dùng cho nút "Hoàn tất cấu hình" trên FE.
   */
  async generateSlotsForLot(lotId: number): Promise<{
    totalAdded: number;
    totalDisabled: number;
    perFloor: Array<{
      floorId: number;
      floorName: string;
      totalAdded: number;
      totalDisabled: number;
      perZone: Array<{
        zoneId: number;
        zoneName: string;
        added: number;
        disabled: number;
      }>;
    }>;
  }> {
    const lot = await this.parkingLotRepository.findOne({
      where: { id: lotId },
      relations: ['parkingFloor'],
    });
    if (!lot) throw new NotFoundException('Không tìm thấy parking lot');

    if (!lot.parkingFloor || lot.parkingFloor.length === 0) {
      throw new BadRequestException('Parking lot chưa có floor nào');
    }

    let totalAdded = 0;
    let totalDisabled = 0;
    const perFloor: Array<{
      floorId: number;
      floorName: string;
      totalAdded: number;
      totalDisabled: number;
      perZone: Array<{
        zoneId: number;
        zoneName: string;
        added: number;
        disabled: number;
      }>;
    }> = [];

    for (const floor of lot.parkingFloor) {
      const result = await this.generateSlotsForFloor(lotId, floor.id);
      totalAdded += result.totalAdded;
      totalDisabled += result.totalDisabled;
      perFloor.push({
        floorId: floor.id,
        floorName: floor.floor_name,
        totalAdded: result.totalAdded,
        totalDisabled: result.totalDisabled,
        perZone: result.perZone,
      });
    }

    return { totalAdded, totalDisabled, perFloor };
  }

  /**
   * Lấy danh sách slots của 1 Zone (để preview trên UI).
   * Mặc định ẩn slot DISABLED, truyền includeDisabled=true để xem tất cả.
   */
  async getSlotsByZone(
    lotId: number,
    floorId: number,
    zoneId: number,
    includeDisabled = false,
  ) {
    const zone = await this.parkingZoneRepository.findOne({
      where: {
        id: zoneId,
        parkingFloor: { id: floorId, parkingLot: { id: lotId } },
      },
    });
    if (!zone) {
      throw new NotFoundException(
        'Không tìm thấy zone hoặc zone không thuộc floor/lot này',
      );
    }

    const where: any = { parkingZone: { id: zoneId } };
    if (!includeDisabled) {
      where.status = Not(SlotStatus.DISABLED);
    }

    return await this.parkingSlotRepository.find({
      where,
      order: { id: 'ASC' },
      select: ['id', 'code', 'status'],
    });
  }

  // =========== Đếm tổng số bãi đỗ xe (ADMIN) ================
  async countTotalParkingLots() {
    return this.parkingLotRepository.count();
  }

  //bãi đỗ xe gần nhất
  async haversineParkingLot(parkingLotId: number, lat: number, lng: number) {
    return await this.parkingLotRepository
      .createQueryBuilder('pl')
      .leftJoin('Review', 'r', 'r.parking_lot_id = pl.id')
      .select([
        'pl.id AS id',
        'pl.name AS name',
        'pl.address AS address',
        'pl.image AS image',
      ])
      // parking-lot.service.ts
      .addSelect('ROUND(COALESCE(AVG(r.rating), 0), 1)', 'avgRating')
      .addSelect(
        `ST_DistanceSphere(
        ST_MakePoint(pl.lng::float, pl.lat::float), 
        ST_MakePoint(:lng::float, :lat::float)
      ) / 1000`,
        'distance',
      )
      // QUAN TRỌNG: Phải setParameters ở đây để addSelect nhận được lat/lng
      .setParameters({
        lng: Number(lng),
        lat: Number(lat),
        parkingLotId,
      })
      .where('pl.id != :parkingLotId AND pl.status = :status', {
        parkingLotId,
        status: 'INACTIVE',
      })
      .groupBy('pl.id')
      .addGroupBy('pl.name')
      .addGroupBy('pl.address')
      .addGroupBy('pl.image')
      .orderBy('distance', 'ASC')
      .limit(4)
      .getRawMany();
  }

  //lấy bình luận
  async getCommentUser(parkingLotId: number) {
    return this.reviewRepository.find({
      where: {
        lot: { id: parkingLotId },
      },
      relations: ['user.profile'],
      order: { created_at: 'DESC' },
    });
  }

  // ============ Đếm số bãi đỗ xe của chủ sở hữu ==================
  async countParkingLotsByOwnerId(ownerId: string) {
    return this.parkingLotRepository.count({
      where: { owner: { id: ownerId } },
    });
  }

  async countParkingLotsByOwnerIds(ownerIds: string[]) {
    if (!ownerIds.length) {
      return new Map<string, number>();
    }

    const rows = await this.parkingLotRepository
      .createQueryBuilder('parkingLot')
      .leftJoin('parkingLot.owner', 'owner')
      .select('owner.id', 'ownerId')
      .addSelect('COUNT(parkingLot.id)', 'totalParkingLots')
      .where('owner.id IN (:...ownerIds)', { ownerIds })
      .groupBy('owner.id')
      .getRawMany();

    return new Map<string, number>(
      rows.map((row) => [row.ownerId, Number(row.totalParkingLots) || 0]),
    );
  }
}
