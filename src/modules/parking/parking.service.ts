import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ParkingLot } from './entities/parking-lot.entity';
import { ParkingSlot } from './entities/parking-slot.entity';
import { OwnerRequest } from './entities/owner-request.entity';
import { BecomeOwnerDto } from './dto/become-owner.dto';
import { UsersService } from '../users/users.service';

@Injectable()
export class ParkingService {
  constructor(
    @InjectRepository(ParkingLot)
    private parkingLotRepository: Repository<ParkingLot>,
    @InjectRepository(ParkingSlot)
    private parkingSlotRepository: Repository<ParkingSlot>,
    @InjectRepository(OwnerRequest)
    private ownerRequestRepository: Repository<OwnerRequest>,
    private usersService: UsersService,
  ) {}
//   Cho phép người dùng trở thành chủ sở hữu của một bãi đậu xe mới.
// 1. Kiểm tra xem người dùng có tồn tại hay không. Nếu không, trả về lỗi BadRequestException.
// 2. Cập nhật số điện thoại của người dùng nếu họ chưa có thông tin này trong hồ sơ của mình.
  async becomeOwner(userId: string, dto: BecomeOwnerDto, files?: Array<Express.Multer.File>) {
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
      const floorIdx = slotConfig.floorNumber ? Number(slotConfig.floorNumber) - 1 : index;
      for (let i = 1; i <= numSlots; i++) {
        totalSlots++;
        slotsToSave.push(
          this.parkingSlotRepository.create({
            parkingLot: savedParking,
            code: `F${floorIdx + 1}-${i}`,
            type: 'REGULAR',
            status: 'AVAILABLE',
          })
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

    const businessLicenseFile = files?.find(f => f.fieldname === 'businessLicense');
    const businessLicenseUrl = businessLicenseFile ? `uploads/${businessLicenseFile.originalname}` : null;

    const ownerRequest = this.ownerRequestRepository.create({
      user: user,
      parkingLot: savedParking,
      taxCode: dto.taxCode,
      description: dto.description,
      businessLicense: businessLicenseUrl || undefined,
      status: 'PENDING',
    });

    await this.ownerRequestRepository.save(ownerRequest);

    await this.usersService.makeOwner(userId);

    return { 
      message: 'Created parking lot successfully & owner request submitted',
      parkingLotId: savedParking.id,
      ownerRequestId: ownerRequest.id
    };
  }
}