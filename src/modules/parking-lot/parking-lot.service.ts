import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Not, EntityManager, ILike } from 'typeorm';
import { ParkingLot } from './entities/parking-lot.entity';
import { Booking } from '../booking/entities/booking.entity';
import { ParkingLotUserResDto } from './dto/parking-lot-user-res.dto';
import {
  OwnerParkingLotResDto,
  OwnerParkingLotTotalsResDto,
} from './dto/owner-parking-lot-res.dto';
import { CreateParkingLotReqDto } from './dto/create-parking-lot-req.dto';
import {
  BookingStatus,
  ParkingLotStatus,
  SlotStatus,
} from 'src/common/enums/status.enum';
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
import { PricingRule } from '../payment/entities/pricingrule.entity';
import { ManualBookingDto } from './dto/manual-booking.dto';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { UpdateParkingLotReqDto } from './dto/update-parking-lot-req.dto';

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

    @InjectRepository(PricingRule)
    private pricingRuleRepository: Repository<PricingRule>,

    private requestService: RequestService,

    private usersService: UsersService,
    private dataSource: DataSource,
    private readonly supabaseService: SupabaseService,
  ) {}

  async createParkingLot(
    createParkingLotDto: CreateParkingLotReqDto,
    files?: Array<Express.Multer.File>,
  ) {
    let thumbnail: string | undefined = undefined;
    let gallery: string[] | undefined = undefined;

    if (files && files.length > 0) {
      const uploadPromises = files.map((file) => this.supabaseService.uploadFile(file, 'parkinglot'));
      const uploadedUrls = await Promise.all(uploadPromises);
      thumbnail = uploadedUrls[0];
      if (uploadedUrls.length > 1) {
        gallery = uploadedUrls.slice(1);
      }
    }

    const parkingLot: ParkingLot = this.parkingLotRepository.create({
      name: createParkingLotDto.name,
      address: createParkingLotDto.address,
      lat: createParkingLotDto.lat,
      lng: createParkingLotDto.lng,
      total_slots: createParkingLotDto.totalSlots ?? 0,
      available_slots:
        createParkingLotDto.availableSlots ??
        createParkingLotDto.totalSlots ??
        0,
      description: createParkingLotDto.description,
      image: { thumbnail, gallery },
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

  // ─── Update parking lot ────────────────────────────────────────────────────
  async updateParkingLot(
    parkingLotId: number,
    updateDto: UpdateParkingLotReqDto,
    ownerId: string,
    files?: Array<Express.Multer.File>,
  ) {
    const parkingLot = await this.parkingLotRepository.findOne({
      where: { id: parkingLotId, owner: { id: ownerId } },
      relations: ['owner'],
    });

    if (!parkingLot) {
      throw new NotFoundException('Không tìm thấy bãi đỗ xe hoặc bạn không có quyền truy cập');
    }

    if (updateDto.name) {
      parkingLot.name = updateDto.name;
    }
    
    if (updateDto.description !== undefined) {
      parkingLot.description = updateDto.description;
    }

    if (files && files.length > 0) {
      const uploadPromises = files.map((file) => this.supabaseService.uploadFile(file, 'parkinglot'));
      const uploadedUrls = await Promise.all(uploadPromises);

      const currentImage = parkingLot.image || {};
      const newThumbnail = uploadedUrls[0];
      const newGallery = uploadedUrls.slice(1);

      parkingLot.image = {
        ...currentImage,
        thumbnail: newThumbnail,
        gallery: newGallery.length > 0 ? newGallery : currentImage.gallery,
      };
    }

    const updatedParkingLot = await this.parkingLotRepository.save(parkingLot);
    return OwnerParkingLotResDto.fromEntity(updatedParkingLot);
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
      where: {
        slot: {
          parkingZone: {
            parkingFloor: {
              parkingLot: { id: parkingLotId },
            },
          },
        },
      },
      relations: ['user', 'user.profile', 'vehicle', 'slot'],
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
      .innerJoin('b.slot', 's')
      .innerJoin('s.parkingZone', 'z')
      .innerJoin('z.parkingFloor', 'f')
      .where('f.parkingLot = :parkingLotId', { parkingLotId })
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

  // ─── Get all parking lots (for all users) ─────────────────────────────────
  async getAllParkingLots() {
    return await this.parkingLotRepository.find({
      where: { status: ParkingLotStatus.ACTIVE },
      relations: ['parkingFloor', 'parkingFloor.parkingZones'],
    });
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
    for (const [index, slotConfig] of (parsedFloorSlots as any[]).entries()) {
      const floorNum = slotConfig.floorNumber
        ? Number(slotConfig.floorNumber)
        : index + 1;

      // 1. Tạo Floor cho mỗi cấu hình tầng
      const floor = this.parkingFloorRepository.create({
        floor_name: `Tầng ${floorNum}`,
        floor_number: floorNum,
        parkingLot: savedParking,
      });
      const savedFloor = await this.parkingFloorRepository.save(floor);

      let zonesConfig = slotConfig.zones;
      if (!zonesConfig || !Array.isArray(zonesConfig)) {
        const numSlots = Number(slotConfig.capacity || slotConfig || 0);
        zonesConfig = [{ zoneNumber: 1, capacity: numSlots }];
      }

      for (const [zIdx, zConf] of zonesConfig.entries()) {
        const numSlots = Number(zConf.capacity || 0);
        const zNum = zConf.zoneNumber ? Number(zConf.zoneNumber) : zIdx + 1;

        // 2. Tạo một Zone mặc định cho mỗi tầng
        const zone = this.parkingZoneRepository.create({
          zone_name: zonesConfig.length === 1 ? 'Khu vực chính' : `Khu ${zNum}`,
          prefix: `F${floorNum}Z${zNum}`,
          parkingFloor: savedFloor,
          total_slots: numSlots,
        });
        const savedZone = await this.parkingZoneRepository.save(zone);

        for (let i = 1; i <= numSlots; i++) {
          totalSlots++;
          slotsToSave.push(
            this.parkingSlotRepository.create({
              code: `F${floorNum}Z${zNum}-${String(i).padStart(3, '0')}`,
              status: SlotStatus.AVAILABLE,
              parkingZone: savedZone,
            }),
          );
        }
      }
    }
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
        status: BookingStatus.ONGOING,
        start_time: new Date(),
        end_time: new Date(), // Set temporary end_time
        user: user,
        vehicle: vehicle,
        // parkingLot removed as it's redundant
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

  // ─── Manual Booking (Owner đặt chỗ thủ công cho khách vãng lai) ───────────
  async handleManualBooking(
    parkingLotId: number,
    dto: ManualBookingDto,
    ownerId: string,
  ) {
    // 1. Xác minh bãi tồn tại và thuộc owner
    const parkingLot = await this.parkingLotRepository.findOne({
      where: { id: parkingLotId, owner: { id: ownerId } },
      relations: ['owner'],
    });
    if (!parkingLot) {
      throw new NotFoundException(
        'Không tìm thấy bãi đỗ xe hoặc bạn không có quyền truy cập',
      );
    }

    // 2. Xác minh slot thuộc bãi này và load thông tin zone + pricing
    const slot = await this.parkingSlotRepository.findOne({
      where: { id: dto.slotId },
      relations: [
        'parkingZone',
        'parkingZone.parkingFloor',
        'parkingZone.parkingFloor.parkingLot',
        'parkingZone.pricingRule',
      ],
    });

    if (
      !slot ||
      slot.parkingZone?.parkingFloor?.parkingLot?.id !== parkingLotId
    ) {
      throw new NotFoundException(
        'Không tìm thấy vị trí đỗ hoặc vị trí không thuộc bãi này',
      );
    }

    if (slot.status !== SlotStatus.AVAILABLE) {
      throw new BadRequestException(
        `Vị trí đỗ ${slot.code} hiện không khả dụng (${slot.status})`,
      );
    }

    // 3. Lấy thông tin giá từ zone
    const pricingRule = slot.parkingZone.pricingRule?.[0] ?? null;
    const pricePerHour = pricingRule?.price_per_hour ?? 0;
    const pricePerDay = pricingRule?.price_per_day ?? 0;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 4. Tìm/Tạo ghost user theo SĐT
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

      // 5. Tìm/Tạo vehicle theo biển số
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
      } else if (vehicle.user.id !== user.id) {
        vehicle.user = user;
        vehicle = await queryRunner.manager.save(Vehicle, vehicle);
      }

      // 6. Tạo booking ONGOING (owner đặt = check-in luôn)
      const booking = queryRunner.manager.create(Booking, {
        status: BookingStatus.ONGOING,
        start_time: new Date(dto.startTime),
        end_time: new Date(dto.startTime), // placeholder — cập nhật khi checkout
        user: user,
        vehicle: vehicle,
        slot: slot,
      });
      await queryRunner.manager.save(Booking, booking);

      // 7. Cập nhật trạng thái slot → OCCUPIED
      await queryRunner.manager.update(
        ParkingSlot,
        { id: slot.id },
        { status: SlotStatus.OCCUPIED },
      );

      // 8. Giảm available_slots của bãi
      await queryRunner.manager.decrement(
        ParkingLot,
        { id: parkingLotId },
        'available_slots',
        1,
      );

      await queryRunner.commitTransaction();

      return {
        message: 'Đặt chỗ thủ công thành công',
        bookingId: booking.id,
        slotCode: slot.code,
        zoneName: slot.parkingZone.zone_name,
        floorName: slot.parkingZone.parkingFloor.floor_name,
        startTime: booking.start_time,
        customerName: dto.name,
        phoneNumber: dto.phoneNumber,
        licensePlate: standardizedPlate,
        pricing: {
          pricePerHour,
          pricePerDay,
        },
      };
    } catch (error: unknown) {
      await queryRunner.rollbackTransaction();
      console.error('Manual Booking Error:', error);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Không thể tạo đặt chỗ thủ công, vui lòng thử lại',
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
        'owner.profile',
        'parkingFloor',
        'parkingFloor.parkingZones',
        'parkingFloor.parkingZones.pricingRule',
        'parkingFloor.parkingZones.slot',
      ],
    });

    if (!lot) throw new NotFoundException('Not found Parking Lot');

    const flatpricingRules = lot.parkingFloor.flatMap((floor) =>
      floor.parkingZones.flatMap((zone) =>
        zone.pricingRule.map((rule) => ({
          ...rule,
          zone_name: zone.zone_name,
          floor_name: floor.floor_name,
        })),
      ),
    );

    //lấy danh sách xe của người dùng
    const vehicleUser = await this.vehicleRepository.find({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    // lấy giá của tất cả các rule để FE dễ dàng hiển thị giá khi user chọn zone nào đó (thay vì phải đợi đến lúc chọn zone mới gọi API lấy giá) => tối ưu trải nghiệm người dùng
    const allPricingRules: any[] = [];
    if (lot.parkingFloor) {
      for (const floor of lot.parkingFloor) {
        if (floor.parkingZones) {
          for (const zone of floor.parkingZones) {
            if (zone.pricingRule) {
              for (const rule of zone.pricingRule) {
                allPricingRules.push({
                  ...rule,
                  parkingZone: {
                    id: zone.id,
                    zone_name: zone.zone_name,
                    prefix: zone.prefix,
                    description: zone.description,
                  },
                  parkingFloor: {
                    id: floor.id,
                    floor_name: floor.floor_name,
                  },
                });
              }
            }
          }
        }
      }
    }

    return {
      ...lot,
      userVehicles: vehicleUser,
      pricingRules: flatpricingRules,
    };
  }

  /**
   * Lấy sơ đồ bãi đỗ và tính toán lại trạng thái slot dựa trên khung giờ yêu cầu
   * (Dành cho chức năng đặt chỗ rạp chiếu phim - Cinema Style)
   */
  async getAvailableMapByTime(
    lotid: number,
    userId: string,
    startTime: string,
    endTime: string,
  ) {
    // 1. Lấy sơ đồ gốc và xe của user (tận dụng logic getMapForBooking)
    const lotData: any = await this.getMapForBooking(lotid, userId);

    // 2. Tìm tất cả các booking trùng lặp thời gian trong bãi này
    // Điều kiện overlap: (b.start_time < requested_end) AND (b.end_time > requested_start)
    const busyBookings = await this.bookingRepository
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.slot', 'slot')
      .innerJoin('slot.parkingZone', 'zone')
      .innerJoin('zone.parkingFloor', 'floor')
      .where('floor.parkingLot = :lotId', { lotId: lotid })
      .andWhere('b.status NOT IN (:...excludeStatuses)', {
        excludeStatuses: ['completed', 'cancelled', 'COMPLETED', 'CANCELLED'],
      })
      .andWhere('b.start_time < :endTime', { endTime: new Date(endTime) })
      .andWhere('b.end_time > :startTime', { startTime: new Date(startTime) })
      .getMany();

    // 3. Tạo tập hợp các Slot ID đã bị đặt
    const busySlotIds = new Set(
      busyBookings.map((b) => b.slot?.id).filter((id) => id !== undefined),
    );

    // 4. Duyệt qua cấu trúc phân cấp và cập nhật trạng thái slot dựa trên logic rạp phim
    if (lotData.parkingFloor) {
      lotData.parkingFloor.forEach((floor: any) => {
        if (floor.parkingZones) {
          floor.parkingZones.forEach((zone: any) => {
            if (zone.slot) {
              zone.slot.forEach((slot: any) => {
                // Nếu slot thực tế đang AVAILABLE nhưng lại nằm trong danh sách bận của khung giờ này
                if (
                  slot.status === SlotStatus.AVAILABLE &&
                  busySlotIds.has(slot.id)
                ) {
                  // Ghi đè thành RESERVED để FE đổi màu xám/đỏ khách không chọn được
                  slot.status = SlotStatus.RESERVED;
                }
              });
            }
          });
        }
      });
    }

    return lotData;
  }

  /**
   * Lấy lịch trình chi tiết của 1 Slot cụ thể trong 1 ngày
   * Giúp Owner biết slot đó bận/trống vào lúc nào trong ngày
   */
  async getSlotAvailability(slotId: number, dateStr: string) {
    const startOfDay = new Date(dateStr);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(dateStr);
    endOfDay.setHours(23, 59, 59, 999);

    const slot = await this.parkingSlotRepository.findOne({
      where: { id: slotId },
      relations: [
        'parkingZone',
        'parkingZone.parkingFloor',
        'parkingZone.parkingFloor.parkingLot',
      ],
    });

    if (!slot) {
      throw new NotFoundException('Không tìm thấy vị trí đỗ');
    }

    const bookings = await this.bookingRepository
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.user', 'user')
      .leftJoinAndSelect('user.profile', 'profile')
      .leftJoinAndSelect('b.vehicle', 'vehicle')
      .where('b.slot_id = :slotId', { slotId }) // Dùng slot_id là tên cột trong DB
      .andWhere('b.status NOT IN (:...excludeStatuses)', {
        excludeStatuses: [
          'CANCELLED',
          'cancelled',
          BookingStatus.COMPLETED, // Thường owner chỉ quan tâm các lịch sắp tới hoặc đang diễn ra
        ],
      })
      .andWhere('b.start_time <= :endOfDay', { endOfDay })
      .andWhere('b.end_time >= :startOfDay', { startOfDay })
      .orderBy('b.start_time', 'ASC')
      .getMany();

    return {
      slotId: slot.id,
      slotCode: slot.code,
      zoneName: slot.parkingZone.zone_name,
      floorName: slot.parkingZone.parkingFloor.floor_name,
      parkingLotName: slot.parkingZone.parkingFloor.parkingLot.name,
      date: dateStr,
      bookings: bookings.map((b) => ({
        id: b.id,
        startTime: b.start_time,
        endTime: b.end_time,
        status: b.status,
        userName: b.user?.profile?.name || b.user?.email || 'N/A',
        licensePlate: b.vehicle?.plate_number || 'N/A',
      })),
    };
  }

  // ─── Floor & Zone Management (Customization) ──────────────────────────────

  async getFloorsByParkingLot(lotId: number) {
    return await this.parkingFloorRepository.find({
      where: { parkingLot: { id: lotId } },
      relations: ['parkingZones'],
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

  private async syncHierarchyTotals(floorId: number, manager?: EntityManager) {
    const floorRepo = manager
      ? manager.getRepository(ParkingFloor)
      : this.parkingFloorRepository;
    const lotRepo = manager
      ? manager.getRepository(ParkingLot)
      : this.parkingLotRepository;
    const slotRepo = manager
      ? manager.getRepository(ParkingSlot)
      : this.parkingSlotRepository;

    // 1. Update Floor total_slots (dựa trên metadata zone.total_slots)
    const floor = await floorRepo.findOne({
      where: { id: floorId },
      relations: ['parkingZones', 'parkingLot'],
    });

    if (!floor) return;

    const totalFloorSlots = floor.parkingZones.reduce(
      (sum, zone) => sum + (zone.total_slots || 0),
      0,
    );
    floor.total_slots = totalFloorSlots;
    await floorRepo.save(floor);

    // 2. Update ParkingLot total_slots + available_slots từ slot thực tế trong DB
    const lotId = floor.parkingLot.id;
    const lot = await lotRepo.findOne({
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
    const availableCount = await slotRepo.count({
      where: {
        parkingZone: {
          parkingFloor: {
            parkingLot: { id: lotId },
          },
        },
        status: SlotStatus.AVAILABLE,
      },
    });
    lot.available_slots = availableCount;

    await lotRepo.save(lot);
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
    manager?: EntityManager,
    skipSync = false,
  ): Promise<{ added: number; disabled: number }> {
    const zoneRepo = manager
      ? manager.getRepository(ParkingZone)
      : this.parkingZoneRepository;
    const slotRepo = manager
      ? manager.getRepository(ParkingSlot)
      : this.parkingSlotRepository;

    // 1. Verify zone thuộc đúng floor & lot
    const zone = await zoneRepo.findOne({
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

    const targetCount = zone.total_slots;

    // 2. Lấy tất cả slot ACTIVE (không phải DISABLED) của zone
    const activeSlots = await slotRepo.find({
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
      const allSlots = await slotRepo.find({
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
          slotRepo.create({
            code: `${prefix}${stt}`,
            status: SlotStatus.AVAILABLE,
            parkingZone: zone,
          }),
        );
      }
      await slotRepo.save(newSlots);
      if (!skipSync) await this.syncHierarchyTotals(floorId, manager);
      return { added: toAdd, disabled: 0 };
    }

    // CASE B: total_slots giảm → vô hiệu hoá slot AVAILABLE cuối
    const toDisable = currentActiveCount - targetCount;

    // Chỉ disable slot AVAILABLE (không được disable OCCUPIED/RESERVED)
    const availableSlots = await slotRepo.find({
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
    await slotRepo.save(slotsToDisable);
    if (!skipSync) await this.syncHierarchyTotals(floorId, manager);
    return { added: 0, disabled: toDisable };
  }

  /**
   * Generate / sync slots cho tất cả zones của 1 Floor.
   */
  async generateSlotsForFloor(
    lotId: number,
    floorId: number,
    manager?: EntityManager,
    skipSync = false,
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
    const zoneRepo = manager
      ? manager.getRepository(ParkingZone)
      : this.parkingZoneRepository;

    const zones = await zoneRepo.find({
      where: {
        parkingFloor: { id: floorId, parkingLot: { id: lotId } },
      },
    });

    if (zones.length === 0) {
      // Thay vì throw 404, ta return kết quả trống để generate-all lot có thể tiếp tục
      return { totalAdded: 0, totalDisabled: 0, perZone: [] };
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
      const result = await this.generateSlotsForZone(
        lotId,
        floorId,
        zone.id,
        manager,
        skipSync,
      );
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

    // Dùng transaction để đảm bảo tính toàn vẹn và tối ưu performance
    return await this.dataSource.transaction(async (manager) => {
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
        // skipSync=true để không gọi syncHierarchy cho từng zone/floor
        const result = await this.generateSlotsForFloor(
          lotId,
          floor.id,
          manager,
          true,
        );
        totalAdded += result.totalAdded;
        totalDisabled += result.totalDisabled;
        perFloor.push({
          floorId: floor.id,
          floorName: floor.floor_name,
          totalAdded: result.totalAdded,
          totalDisabled: result.totalDisabled,
          perZone: result.perZone,
        });

        // Sync cho từng floor sau khi xong tất cả zone của floor đó (nhưng vẫn có thể tối ưu hơn nữa)
        if (result.totalAdded > 0 || result.totalDisabled > 0) {
          await this.syncHierarchyTotals(floor.id, manager);
        }
      }

      return { totalAdded, totalDisabled, perFloor };
    });
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
        status: 'ACTIVE',
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

  // ============ Đếm số bãi đỗ xe theo trạng thái (ADMIN) ==================
  async countParkingLotsByStatus(status: string) {
    return this.parkingLotRepository.count({
      where: { status },
    });
  }
  // =========== Đếm số slot theo trạng thái (ADMIN) vd: 33/100 ==================
  async countAllAvailableSpacesParkingSlot() {
    const totalSlots = await this.parkingSlotRepository.count();
    const availableSlots = await this.parkingSlotRepository.count({
      where: { status: SlotStatus.AVAILABLE },
    });
    return `${availableSlots}/${totalSlots}`;
  }

  // ============ Tính trung bình đánh giá của tất cả bãi đỗ xe (ADMIN) theo 0-5.0 ==================
  async calculateAverageRating() {
    const result = await this.reviewRepository
      .createQueryBuilder('review')
      .select('ROUND(AVG(review.rating), 1)', 'avgRating')
      .getRawOne();

    return result?.avgRating || '0.0';
  }

  // ============ Tính trung bình đánh giá của 1 bãi đỗ xe (ADMIN) theo 0-5.0 ==================
  async calculateAverageRatingByParkingLotId(parkingLotId: number) {
    const result = await this.reviewRepository
      .createQueryBuilder('review')
      .where('review.parking_lot_id = :parkingLotId', { parkingLotId })
      .select('ROUND(AVG(review.rating), 1)', 'avgRating')
      .getRawOne();

    return result?.avgRating || '0.0';
  }

  // ============ Lấy danh sách bãi đỗ xe (ADMIN) với phân trang ==================
  // return: {items , meta}
  async findAllPaginatedWithSearch(
    page: number,
    limit: number,
    search?: string,
  ) {
    const [items, total] = await this.parkingLotRepository.findAndCount({
      where: search ? { name: ILike(`%${search}%`) } : {}, // Nếu có search thì filter theo tên, không thì lấy tất cả
      relations: [
        'owner',
        'owner.profile',
        'parkingFloor',
        'parkingFloor.parkingZones',
      ], // Kéo thêm dữ liệu các bảng liên kết
      order: { id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items,
      meta: {
        totalItems: total,
        itemCount: items.length,
        itemsPerPage: limit,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
      },
    };
  }

  // =========== Đếm slot còn trống theo từng bãi đỗ xe (ADMIN) ==================
  async countAvailableSpaces(parkingLotId: number) {
    const totalSlots = await this.parkingSlotRepository.count({
      where: {
        parkingZone: {
          parkingFloor: {
            parkingLot: { id: parkingLotId },
          },
        },
      },
    });

    const availableSlots = await this.parkingSlotRepository.count({
      where: {
        parkingZone: {
          parkingFloor: {
            parkingLot: { id: parkingLotId },
          },
        },
        status: SlotStatus.AVAILABLE,
      },
    });

    return { totalSlots, availableSlots };
  }

  // =========== Đếm slot còn trống theo Mảng LOT ID (Solve N+1) ==================
  async countAvailableSpacesByLotIds(
    lotIds: number[],
  ): Promise<Map<number, { totalSlots: number; availableSlots: number }>> {
    if (!lotIds || lotIds.length === 0) return new Map();

    const result = await this.parkingSlotRepository
      .createQueryBuilder('slot')
      .innerJoin('slot.parkingZone', 'zone')
      .innerJoin('zone.parkingFloor', 'floor')
      .innerJoin('floor.parkingLot', 'lot')
      .select('lot.id', 'lotId')
      .addSelect('COUNT(slot.id)', 'totalSlots')
      .addSelect(
        "SUM(CASE WHEN slot.status = 'AVAILABLE' THEN 1 ELSE 0 END)",
        'availableSlots',
      )
      .where('lot.id IN (:...lotIds)', { lotIds })
      .groupBy('lot.id')
      .getRawMany();

    const map = new Map<
      number,
      { totalSlots: number; availableSlots: number }
    >();
    result.forEach((row) => {
      map.set(Number(row.lotId), {
        totalSlots: Number(row.totalSlots) || 0,
        availableSlots: Number(row.availableSlots) || 0,
      });
    });

    return map;
  }

  // =========== Đếm slot còn trống theo Mảng ZONE ID==================
  async countAvailableSpacesByZoneIds(
    zoneIds: number[],
  ): Promise<Map<number, number>> {
    if (!zoneIds || zoneIds.length === 0) return new Map();

    const result = await this.parkingSlotRepository
      .createQueryBuilder('slot')
      .innerJoin('slot.parkingZone', 'zone')
      .select('zone.id', 'zoneId')
      .addSelect('COUNT(slot.id)', 'count')
      .where('zone.id IN (:...zoneIds)', { zoneIds })
      .andWhere('slot.status = :status', { status: SlotStatus.AVAILABLE })
      .groupBy('zone.id')
      .getRawMany();

    const map = new Map<number, number>();
    result.forEach((row) => {
      map.set(Number(row.zoneId), Number(row.count));
    });
    return map;
  }

  // ============ lấy giá giờ của bãi đỗ xe (ADMIN) ==================
  async getParkingLotPricing(parkingLotId: number) {
    const pricingRules = await this.pricingRuleRepository
      .createQueryBuilder('rule')
      .innerJoin('rule.parkingZone', 'zone')
      .innerJoin('zone.parkingFloor', 'floor')
      .innerJoin('floor.parkingLot', 'lot')
      .where('lot.id = :parkingLotId', { parkingLotId })
      .select([
        'zone.zone_name AS zoneName',
        'rule.price_per_hour AS pricePerHour',
        'rule.price_per_day AS pricePerDay',
      ])
      .getRawMany();

    return pricingRules;
  }

  // ============ lấy giá đồng loạt của nhiều bãi đỗ xe ==================
  async getPricingByLotIds(
    lotIds: number[],
  ): Promise<Map<number, { pricePerHour: number; pricePerDay: number }>> {
    if (!lotIds || lotIds.length === 0) return new Map();

    // Tìm rules thuộc các lotIds
    const results = await this.pricingRuleRepository
      .createQueryBuilder('rule')
      .innerJoin('rule.parkingZone', 'zone')
      .innerJoin('zone.parkingFloor', 'floor')
      .innerJoin('floor.parkingLot', 'lot')
      .where('lot.id IN (:...lotIds)', { lotIds })
      .select([
        'lot.id AS "lotId"',
        'rule.price_per_hour AS "pricePerHour"',
        'rule.price_per_day AS "pricePerDay"',
      ])
      .getRawMany();

    // Gom nhóm rule đầu tiên hoặc lớn nhất vào Map
    const map = new Map<
      number,
      { pricePerHour: number; pricePerDay: number }
    >();
    results.forEach((row) => {
      const lotId = Number(row.lotId);
      if (!map.has(lotId)) {
        map.set(lotId, {
          pricePerHour: Number(row.pricePerHour) || 0,
          pricePerDay: Number(row.pricePerDay) || 0,
        });
      }
    });
    return map;
  }

  // =========== Đếm tổng review của bãi đỗ xe (ADMIN) ==================
  async countTotalReviewsByParkingLotId(parkingLotId: number) {
    return await this.reviewRepository.count({
      where: { lot: { id: parkingLotId } },
    });
  }

  // =========== Tính Rate và Review đồng loạt cho nhiều bãi ==================
  async getReviewStatsByLotIds(
    lotIds: number[],
  ): Promise<Map<number, { avgRating: string; totalReviews: number }>> {
    if (!lotIds || lotIds.length === 0) return new Map();

    const results = await this.reviewRepository
      .createQueryBuilder('review')
      .where('review.parking_lot_id IN (:...lotIds)', { lotIds })
      .select('review.parking_lot_id', 'lotId')
      .addSelect('ROUND(AVG(review.rating), 1)', 'avg')
      .addSelect('COUNT(review.id)', 'count')
      .groupBy('review.parking_lot_id')
      .getRawMany();

    const map = new Map<number, { avgRating: string; totalReviews: number }>();
    results.forEach((row) => {
      map.set(Number(row.lotId), {
        avgRating: row.avg ? String(row.avg) : '0.0',
        totalReviews: Number(row.count) || 0,
      });
    });
    return map;
  }
}
