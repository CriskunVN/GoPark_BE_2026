import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { UserRole } from './entities/user-role.entity';
import { Profile } from './entities/profile.entity';
import { UserResDto } from './dto/user-res.dto';

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
// Tạo người dùng mới với vai trò mặc định là "USER" và thông tin hồ sơ nếu có
  async create(createUserDto: CreateUserDto) {
    const {
      role: roleName,
      fullName,
      phoneNumber,
      ...userData
    } = createUserDto;
    if ('id' in userData) delete userData['id'];
// Nếu có role được gửi lên mà không phải là "USER", trả về lỗi vì role này sẽ bị bỏ qua và mặc định là "USER"
    const user = this.usersRepository.create(userData);
    const savedUser = await this.usersRepository.save(user);

    if (fullName || phoneNumber) {
      const profile = this.profileRepository.create({
        name: fullName,
        phone: phoneNumber,
        user: savedUser,
      });
      await this.profileRepository.save(profile);
    }
// Gán vai trò "USER" mặc định cho người dùng mới tạo, nếu role này chưa tồn tại trong database thì sẽ được tạo mới
    const targetRoleName = 'USER';
    const role = await this.roleRepository.findOne({
      where: { name: targetRoleName },
    });

    if (!role) {
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
// Lấy danh sách tất cả người dùng, bao gồm thông tin vai trò, hồ sơ và phương tiện của họ
  async findAll(): Promise<User[]> {
    return this.usersRepository.find({
      relations: ['userRoles', 'userRoles.role', 'profile', 'vehicles'],
    });
  }
// Lấy danh sách người dùng có phân trang, bao gồm thông tin vai trò, hồ sơ và phương tiện của họ
  async findAllPaginated(page = 1, limit = 10) {
    const currentPage = Math.max(1, Number(page) || 1);
    const itemsPerPage = Math.min(100, Math.max(1, Number(limit) || 10));

    const [items, totalItems] = await this.usersRepository.findAndCount({
      relations: ['userRoles', 'userRoles.role', 'profile', 'vehicles'],
      order: { createdAt: 'DESC' },
      skip: (currentPage - 1) * itemsPerPage,
      take: itemsPerPage,
    });

    return {
      items: items,
      meta: {
        totalItems,
        itemCount: items.length,
        itemsPerPage,
        totalPages: Math.ceil(totalItems / itemsPerPage) || 1,
        currentPage,
      },
    };
  }
// Lấy thông tin chi tiết một người dùng theo ID, bao gồm thông tin vai trò, hồ sơ và phương tiện của họ
  async findOne(id: string) {
    const user = await this.usersRepository.findOne({
      where: { id },
      relations: ['userRoles', 'userRoles.role', 'profile', 'vehicles'],
    });
    if (!user)
      throw new NotFoundException(`Không tìm thấy người dùng với ID ${id}`);
    return user;
  }
// Tìm người dùng theo email, bao gồm thông tin vai trò, hồ sơ và phương tiện của họ
  async findByEmail(email: string) {
    const user = await this.usersRepository.findOne({
      where: { email },
      relations: ['userRoles', 'userRoles.role', 'profile'],
    });
    return user;
  }
// Tìm người dùng theo mã xác thực email, bao gồm thông tin vai trò, hồ sơ và phương tiện của họ
  async findByVerifyToken(verifyToken: string) {
    return this.usersRepository.findOne({ where: { verifyToken } });
  }
// Cấp quyền OWNER cho người dùng, nếu họ chưa có quyền này
  async makeOwner(userId: string) {
    const user = await this.findOne(userId);
    let ownerRole = await this.roleRepository.findOne({ where: { name: 'OWNER' } });
    if (!ownerRole) {
      ownerRole = this.roleRepository.create({ name: 'OWNER' });
      await this.roleRepository.save(ownerRole);
    }
// Kiểm tra xem người dùng đã có quyền OWNER chưa, nếu chưa thì gán quyền này cho họ
    const hasOwnerRole = user.userRoles?.some(ur => ur.role?.name === 'OWNER');
    if (!hasOwnerRole) {
      const newRole = this.userRoleRepository.create({ user, role: ownerRole });
      await this.userRoleRepository.save(newRole);
    }
    return true;
  }
// Cập nhật thông tin người dùng, bao gồm cả thông tin hồ sơ nếu có, đảm bảo rằng người dùng tồn tại trước khi cập nhật
  async update(id: string, updateUserDto: UpdateUserDto) {
    const user = await this.findOne(id);
    if (!user)
      throw new NotFoundException(`Không tìm thấy người dùng với ID ${id}`);
    Object.assign(user, updateUserDto);
    return this.usersRepository.save(user);
  }
// Xóa người dùng theo ID, đảm bảo rằng người dùng tồn tại trước khi xóa
  async remove(id: string): Promise<void> {
    const user = await this.findOne(id);
    await this.usersRepository.remove(user);
  }
// Lấy danh sách tất cả chủ bãi đỗ xe (OWNER), bao gồm thông tin vai trò, hồ sơ và phương tiện của họ, với phân trang
  async findAllOwners(page = 1, limit = 10) {
    const currentPage = Math.max(1, Number(page) || 1);
    const itemsPerPage = Math.min(100, Math.max(1, Number(limit) || 10));

    const [owners, totalItems] = await this.usersRepository.findAndCount({
      relations: ['userRoles', 'userRoles.role', 'profile', 'vehicles'],
      where: {
        userRoles: {
          role: {
            name: 'OWNER',
          },
        },
      },
      order: { createdAt: 'DESC' },
      skip: (currentPage - 1) * itemsPerPage,
      take: itemsPerPage,
    });

    const items = UserResDto.fromEntities(owners);

    return {
      items,
      meta: {
        totalItems,
        itemCount: items.length,
        itemsPerPage,
        totalPages: Math.ceil(totalItems / itemsPerPage) || 1,
        currentPage,
      },
    };
  }
// Cập nhật thông tin hồ sơ của người dùng, đảm bảo rằng người dùng tồn tại trước khi cập nhật
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    let user = await this.findOne(userId);
    if (!user.profile) {
      const profile = this.profileRepository.create({ ...dto, user });
      await this.profileRepository.save(profile);
    } else {
      Object.assign(user.profile, dto);
      await this.profileRepository.save(user.profile);
    }
    return this.findOne(userId);
  }
}
