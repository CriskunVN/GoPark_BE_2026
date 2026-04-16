import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { UserRole } from './entities/user-role.entity';
import { Profile } from './entities/profile.entity';
import { UserResDto } from './dto/user-res.dto';
import { Review } from './entities/review.entity';
import { UserRoleEnum } from '../../common/enums/role.enum';

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
    @InjectRepository(Review)
    private ratingUser: Repository<Review>,
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
  // ========== Lấy danh sách người dùng có phân trang và tìm kiếm theo email hoặc tên, bao gồm thông tin vai trò, hồ sơ và phương tiện của họ ================
  async findAllPaginatedWithSearch(
    page = 1,
    limit = 10,
    search?: string,
    roleName?: UserRoleEnum,
  ) {
    const currentPage = Math.max(1, Number(page) || 1);
    const itemsPerPage = Math.min(100, Math.max(1, Number(limit) || 10));

    let queryBuilder = this.usersRepository
      .createQueryBuilder('user')
      .leftJoin('user.userRoles', 'userRoles')
      .leftJoin('userRoles.role', 'role')
      .leftJoinAndSelect('user.profile', 'profile')
      .select([
        'user.id',
        'user.email',
        'user.status',
        'user.createdAt',
        'profile.id',
        'profile.name',
        'profile.phone',
      ])
      .where('role.name = :roleName', { roleName: roleName });
    if (search) {
      queryBuilder = queryBuilder.andWhere(
        'user.email ILIKE :search OR profile.name ILIKE :search',
        { search: `%${search}%` },
      );
    }

    const [items, totalItems] = await queryBuilder
      .orderBy('user.createdAt', 'DESC')
      .skip((currentPage - 1) * itemsPerPage)
      .take(itemsPerPage)
      .getManyAndCount();

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

  // Lấy thông tin chi tiết một người dùng theo ID, bao gồm thông tin vai trò, hồ sơ và phương tiện của họ
  async findOne(id: string) {
    const user = await this.usersRepository.findOne({
      where: { id },
      relations: [
        'userRoles',
        'userRoles.role',
        'profile',
        'vehicles',
        'bookings',
        'bookings.qrCode',
        'bookings.vehicle',
      ],
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
    let ownerRole = await this.roleRepository.findOne({
      where: { name: UserRoleEnum.OWNER },
    });

    if (!ownerRole) {
      ownerRole = this.roleRepository.create({ name: UserRoleEnum.OWNER });
      ownerRole = await this.roleRepository.save(ownerRole);
    }

    // Kiểm tra xem người dùng đã có quyền OWNER chưa
    const existingOwnerRole = await this.userRoleRepository.findOne({
      where: {
        user: { id: userId },
        role: { id: ownerRole.id },
      },
    });

    // Nếu chưa có thì mới thêm vào (giữ nguyên các quyền cũ như USER)
    if (!existingOwnerRole) {
      const newRole = this.userRoleRepository.create({
        user: { id: userId } as any,
        role: { id: ownerRole.id } as any,
      });
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
    const user = await this.findOne(userId);
    if (!user.profile) {
      const profile = this.profileRepository.create({ ...dto, user });
      await this.profileRepository.save(profile);
    } else {
      Object.assign(user.profile, dto);
      await this.profileRepository.save(user.profile);
    }
    return this.findOne(userId);
  }

  // =========== Lấy name bằng userId ================
  async getNameByUserId(userId: string): Promise<string> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      relations: ['profile'],
    });
    if (!user) {
      throw new NotFoundException(`Không tìm thấy người dùng với ID ${userId}`);
    }
    return user.profile?.name || 'Tên không có';
  }

  // =========== Đếm tổng số người dùng và owners ================
  async countTotalUserWithRole(role: UserRoleEnum) {
    return this.usersRepository.count({
      relations: ['userRoles', 'userRoles.role'],
      where: {
        userRoles: {
          role: {
            name: role,
          },
        },
      },
    });
  }

  async countTotalUsers() {
    return this.usersRepository.count();
  }

  // =========== Đếm số người dùng mới trong 1 tháng qua ================
  async countNewUsersInLastMonth() {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    return this.usersRepository.count({
      where: {
        createdAt: MoreThanOrEqual(oneMonthAgo),
      },
    });
  }
  // =========== Đếm số người dùng mới trong 1 tháng qua theo role ================
  async countNewUsersInLastMonthWithRole(role: UserRoleEnum) {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    return this.usersRepository.count({
      relations: ['userRoles', 'userRoles.role'],
      where: {
        userRoles: {
          role: {
            name: role,
          },
        },
        createdAt: MoreThanOrEqual(oneMonthAgo),
      },
    });
  }

  // =========== đếm số user bị khóa ================
  async countBlockedUsers() {
    return this.usersRepository.count({
      where: {
        status: 'BLOCKED',
      },
    });
  }

  // ============ đếm số user bị khóa theo role ================
  async countBlockedUsersWithRole(role: UserRoleEnum) {
    return this.usersRepository.count({
      relations: ['userRoles', 'userRoles.role'],
      where: {
        status: 'BLOCKED',
        userRoles: {
          role: {
            name: role,
          },
        },
      },
    });
  }

  // =========== đếm số user còn hoạt động ================
  async countActiveUsers() {
    return this.usersRepository.count({
      where: {
        status: 'ACTIVE',
      },
    });
  }

  // =========== đếm số user còn hoạt động theo role ================
  async countActiveUserWithRole(role: UserRoleEnum) {
    return this.usersRepository.count({
      relations: ['userRoles', 'userRoles.role'],
      where: {
        status: 'ACTIVE',
        userRoles: {
          role: {
            name: role,
          },
        },
      },
    });
  }
}
