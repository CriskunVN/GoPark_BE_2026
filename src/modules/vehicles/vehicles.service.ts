import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateVehicleDto, UpdateVehicleDto } from './dto/vehicle.dto';
import { Vehicle } from './entities/vehicle.entity';
import { UsersService } from '../users/users.service';

@Injectable()
export class VehiclesService {
  constructor(
    @InjectRepository(Vehicle)
    private readonly vehicleRepository: Repository<Vehicle>,
    private readonly usersService: UsersService,
  ) {}
    // Thêm phương tiện
    // Mỗi user chỉ được đăng ký tối đa 3 phương tiện
  async create(userId: string, createVehicleDto: CreateVehicleDto) {
    const user = await this.usersService.findOne(userId);
    
    // Đếm số lượng xe hiện tại của user này để giới hạn MAX_VEHICLES = 3
    const currentVehiclesCount = await this.vehicleRepository.count({
      where: { user: { id: userId } },
    });

    if (currentVehiclesCount >= 3) {
      throw new BadRequestException('Chỉ được đăng ký tối đa 3 phương tiện.');
    }

    const vehicle = this.vehicleRepository.create({
      ...createVehicleDto,
      user,
    });
    
    const savedVehicle = await this.vehicleRepository.save(vehicle);
    // Trả về ko có user object để tránh vòng lặp json
    const { user: _, ...vehicleWithoutUser } = savedVehicle;
    return vehicleWithoutUser;
  }
// Lấy danh sách phương tiện của user
  async findAllByUser(userId: string) {
    return this.vehicleRepository.find({
      where: { user: { id: userId } },
    });
  }
// Lấy thông tin chi tiết một phương tiện, đảm bảo phương tiện đó thuộc về user
  async findOne(id: number, userId: string) {
    const vehicle = await this.vehicleRepository.findOne({
      where: { id, user: { id: userId } },
    });
    if (!vehicle) {
      throw new NotFoundException('Phương tiện không tồn tại hoặc không thuộc về bạn');
    }
    return vehicle;
  }
// Cập nhật thông tin phương tiện, đảm bảo phương tiện đó thuộc về user
  async update(id: number, userId: string, updateVehicleDto: UpdateVehicleDto) {
    const vehicle = await this.findOne(id, userId);
    Object.assign(vehicle, updateVehicleDto);
    return this.vehicleRepository.save(vehicle);
  }
// Xóa phương tiện, đảm bảo phương tiện đó thuộc về user
  async remove(id: number, userId: string) {
    const vehicle = await this.findOne(id, userId);
    return this.vehicleRepository.remove(vehicle);
  }
}
