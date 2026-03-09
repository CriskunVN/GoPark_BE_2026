import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { UserRole } from './entities/user-role.entity';
import { Profile } from './entities/profile.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
    @InjectRepository(UserRole)
    private userRoleRepository: Repository<UserRole>,
    @InjectRepository(Profile)
    private profileRepository: Repository<Profile>,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    const { role: roleName, fullName, phoneNumber, ...userData } = createUserDto;
    // Bắt buộc xóa id nếu có để tránh lỗi duplicate PK khi insert (đặc biệt khi DTO được map từ entity cũ hoặc test data)
    // Nếu userData chứa id=1 mà db đã có id=1 thì sẽ lỗi 23505
    if ('id' in userData) delete userData['id'];
    
    const user = this.usersRepository.create(userData);
    const savedUser = await this.usersRepository.save(user);

    // Tạo Profile
    if (fullName || phoneNumber) {
      const profile = this.profileRepository.create({
        name: fullName,
        phone: phoneNumber,
        user: savedUser,
      });
      await this.profileRepository.save(profile);
    }

    // Luôn gán role mặc định là CLIENT (USER) cho người dùng đăng ký mới
    const targetRoleName = 'USER'; 
    const role = await this.roleRepository.findOne({ where: { name: targetRoleName } });

    if (!role) {
      // Nếu role chưa tồn tại trong DB, có thể throw error hoặc tự tạo (tùy logic)
      // Ở đây ta giả sử role USER/OWNER/ADMIN đã đợc seed.
      // Tuy nhiên để đảm bảo code chạy được khi chưa seed, ta có thể tạo tạm:
      const newRole = this.roleRepository.create({ name: targetRoleName });
      await this.roleRepository.save(newRole);
      
      const userRole = this.userRoleRepository.create({
        user: savedUser,
        role: newRole,
      });
      await this.userRoleRepository.save(userRole);
    } else {
      const userRole = this.userRoleRepository.create({
        user: savedUser,
        role: role,
      });
      await this.userRoleRepository.save(userRole);
    }

    return this.findOne(savedUser.id);
  }

  async findAll(): Promise<User[]> {
    return this.usersRepository.find({ relations: ['userRoles', 'userRoles.role'] });
  }

  async findOne(id: number): Promise<User> {
    const user = await this.usersRepository.findOne({ 
      where: { id },
      relations: ['userRoles', 'userRoles.role', 'profile']
    });
    if (!user) throw new NotFoundException(`Không tìm thấy người dùng với ID ${id}`);
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({ 
      where: { email },
      relations: ['userRoles', 'userRoles.role']
    });
  }

  async findByVerifyToken(verifyToken: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { verifyToken } });
  }

  async update(id: number, updateUserDto: UpdateUserDto): Promise<User> {
    const user = await this.findOne(id);
    Object.assign(user, updateUserDto);
    return this.usersRepository.save(user);
  }

  async remove(id: number): Promise<void> {
    const user = await this.findOne(id);
    await this.usersRepository.remove(user);
  }
}
