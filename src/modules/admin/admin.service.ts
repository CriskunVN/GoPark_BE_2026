import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { UserResDto } from '../users/dto/user-res.dto';
import { Not, Repository } from 'typeorm';
import { UserStatus } from 'src/common/enums/userStatus.enum';
import { RequestService } from '../request/request.service';
import { ParkingLotStatus, RequestStatus } from 'src/common/enums/status.enum';
import { InjectRepository } from '@nestjs/typeorm';
import { RequestType, Request } from '../request/entities/request.entity';
import { ParkingLotService } from '../parking-lot/parking-lot.service';
import { BookingService } from '../booking/booking.service';
import { ActivityService } from '../activity/activity.service';
import { UserRoleEnum } from 'src/common/enums/role.enum';
import { User } from '../users/entities/user.entity';

@Injectable()
export class AdminService {
  constructor(
    private readonly userService: UsersService,
    private readonly requestService: RequestService,
    private readonly parkingLotService: ParkingLotService,
    private readonly bookingService: BookingService,
    private readonly activityService: ActivityService,
    @InjectRepository(Request) private requestRepository: Repository<Request>,
  ) {}

  //Admin có thể xem tất cả người dùng
  async findAllUsers(page = 1, limit = 10) {
    const { items, meta } = await this.userService.findAllPaginated(
      page,
      limit,
    );

    const data = UserResDto.fromEntities(items ?? []);

    return {
      success: true,
      message: 'Lấy danh sách tài khoản thành công',
      data,
      meta: {
        ...meta,
        itemCount: data.length, // Cập nhật lại itemCount dựa trên số lượng phần tử thực tế trong data
      },
    };
  }

  async findAllOwners(page = 1, limit = 10) {
    const { items, meta } = await this.userService.findAllOwners(page, limit);

    return {
      success: true,
      message: 'Lấy danh sách chủ bãi thành công',
      data: items,
      meta,
    };
  }

  async blockUser(id: string, status: string) {
    if (status === UserStatus.BLOCKED) {
      await this.userService.update(id, { status: UserStatus.BLOCKED });
      return {
        message: 'Người dùng đã bị khóa',
      };
    } else if (status === UserStatus.ACTIVE) {
      await this.userService.update(id, { status: UserStatus.ACTIVE });
      return {
        message: 'Người dùng đã được mở khóa',
      };
    } else {
      throw new NotFoundException('Trạng thái không hợp lệ');
    }
  }

  async findAllRequests(page = 1, limit = 10, status?: string) {
    const data = await this.requestService.findAllRequests(page, limit, status);

    return {
      success: true,
      message: 'Lấy danh sách yêu cầu thành công',
      data,
    };
  }

  //=========== Admin chấp nhận duyệt yêu cầu =================
  async approveRequest(
    requestId: string,
    adminId: string,
    approvalNote?: string,
  ) {
    const request = await this.requestRepository.findOne({
      where: { id: requestId },
      relations: ['requester'],
    });

    if (!request) throw new NotFoundException('Request không tồn tại');
    if (request.status !== RequestStatus.PENDING) {
      throw new BadRequestException('Request đã được xử lý');
    }

    const nameAdmin = await this.userService.getNameByUserId(adminId);

    // Dispatch theo type
    switch (request.type) {
      // xử lý logic duyệt yêu cầu tạo mới bãi đỗ xe
      case RequestType.NEW_PARKING_LOT:
        await this.handleApproveNewParkingLot(request);
        break;
      // xử lý logic duyệt yêu cầu trở thành chủ bãi
      case RequestType.BECOME_OWNER:
        // await this.handleApproveBecomeOwner(request, adminId);
        break;
      // xử lý logic duyệt yêu cầu thanh toán
      case RequestType.PAYMENT:
        // await this.handleApprovePayment(request, adminId);
        break;
      default:
        throw new BadRequestException('Loại request không hợp lệ');
    }

    // Update status của request
    await this.requestRepository.update(requestId, {
      status: RequestStatus.APPROVED,
      note: [
        {
          action: 'APPROVED',
          approvedBy: nameAdmin || adminId,
          timestamp: new Date(),
          reason: approvalNote,
        },
      ],
    });
  }

  // ================== Admin từ chối yêu cầu ==================
  async rejectRequest(requestId: string, adminId: string, reason: string) {
    const request = await this.requestRepository.findOne({
      where: { id: requestId },
      relations: ['requester'],
    });

    if (!request) throw new NotFoundException('Request không tồn tại');
    if (request.status !== RequestStatus.PENDING) {
      throw new BadRequestException('Request đã được xử lý');
    }

    const nameAdmin = await this.userService.getNameByUserId(adminId);

    // Update status của request thành REJECTED và lưu lý do từ chối
    await this.requestRepository.update(requestId, {
      status: RequestStatus.REJECTED,
      note: [
        {
          action: 'REJECTED',
          approvedBy: nameAdmin || adminId,
          timestamp: new Date(),
          reason: reason ?? 'Lí do admin thích :v',
        },
      ],
    });
  }

  // =========== admin xử lý chấp nhận yêu cầu tạo mới bãi đỗ xe =================
  private async handleApproveNewParkingLot(request: Request) {
    // cập nhật status của parking lot thành ACTIVE
    const parkingLotId = request.payload.parkingLotId;
    await this.requestRepository.manager.transaction(
      async (transactionalEntityManager) => {
        await transactionalEntityManager.update(
          'parking_lots',
          { id: parkingLotId },
          { status: ParkingLotStatus.ACTIVE },
        );

        // Send email
        // await this.emailService.sendApprovalEmail(request.requester.email);
      },
    );
  }

  // totalUsers, totalParkingLots, todayBookings, monthlyRevenue (kèm % tăng trưởng)
  async getOverviewStats() {
    const totalUsers = await this.userService.countTotalUsers();
    const totalParkingLots =
      await this.parkingLotService.countTotalParkingLots();
    const todayBookings = await this.bookingService.countTodayBookings();
    const monthlyRevenue = await this.bookingService.calculateMonthlyRevenue();

    return {
      totalUsers,
      totalParkingLots,
      todayBookings,
      monthlyRevenue,
    };
  }

  // =========== Lấy 5 hoạt động gần đây nhất (recent activities) cho dashboard admin ================
  async getRecentActivities() {
    return this.activityService.getRecentActivities(5);
  }

  async getUserStats() {
    // get total users
    const totalUsers = await this.userService.countTotalUserWithRole(
      UserRoleEnum.USER,
    );

    // get new users in the last month
    const newUsersLastMonth = await this.userService.countNewUsersInLastMonth();

    // get active users
    const activeUsers = await this.userService.countActiveUsers();

    // get blocked users
    const blockedUsers = await this.userService.countBlockedUsers();

    return {
      totalUsers,
      newUsersLastMonth,
      activeUsers,
      blockedUsers,
    };
  }

  async getUserList(page = 1, limit = 10, search?: string) {
    // Tên khách hàng , Liên hệ , total Booking , total Chi tiêu , trạng thái , hoạt động
    const { items, meta } = await this.userService.findAllPaginatedWithSearch(
      page,
      limit,
      search,
      UserRoleEnum.USER,
    );

    const data = await Promise.all(
      items.map(async (user) => {
        const totalBookings = await this.bookingService.countBookingsByUserId(
          user.id,
        );
        const totalSpending =
          await this.bookingService.calculateTotalSpendingByUserId(user.id);

        return {
          id: user.id,
          name: user.profile?.name || 'N/A',
          email: user.email,
          phone: user.profile?.phone || 'N/A',
          totalBookings,
          totalSpending,
          status: user.status,
          createdAt: user.createdAt,
        };
      }),
    );

    return {
      success: true,
      message: 'Lấy danh sách người dùng thành công',
      data,
      meta: {
        ...meta,
        itemCount: data.length, // Cập nhật lại itemCount dựa trên số lượng phần tử thực tế trong data
      },
    };
  }

  async getOwnerList(page = 1, limit = 10, search?: string) {
    const { items, meta } = await this.userService.findAllPaginatedWithSearch(
      page,
      limit,
      search,
      UserRoleEnum.OWNER,
    );

    const ownerIds = items.map((owner) => owner.id);
    const [parkingLotsByOwner, bookingStatsByOwner] = await Promise.all([
      this.parkingLotService.countParkingLotsByOwnerIds(ownerIds),
      this.bookingService.getOwnerBookingStatsByOwnerIds(ownerIds),
    ]);

    const data = items.map((owner) => {
      const bookingStats = bookingStatsByOwner.get(owner.id) ?? {
        totalBookings: 0,
        totalRevenue: '0 Tr ₫',
      };

      return {
        id: owner.id,
        name: owner.profile?.name || 'N/A',
        email: owner.email,
        phone: owner.profile?.phone || 'N/A',
        totalParkingLots: parkingLotsByOwner.get(owner.id) ?? 0,
        totalRevenue: bookingStats.totalRevenue,
        totalBookings: bookingStats.totalBookings,
        status: owner.status,
        createdAt: owner.createdAt,
      };
    });

    return {
      success: true,
      message: 'Lấy danh sách chủ bãi thành công',
      data,
      meta: {
        ...meta,
        itemCount: data.length, // Cập nhật lại itemCount dựa trên số lượng phần tử thực tế trong data
      },
    };
  }

  async getOwnerStats() {
    const [totalOwners, newOwnersLastMonth, activeOwners, blockedOwners] =
      await Promise.all([
        this.userService.countTotalUserWithRole(UserRoleEnum.OWNER),
        this.userService.countNewUsersInLastMonthWithRole(UserRoleEnum.OWNER),
        this.userService.countActiveUserWithRole(UserRoleEnum.OWNER),
        this.userService.countBlockedUsersWithRole(UserRoleEnum.OWNER),
      ]);

    return {
      totalOwners,
      newOwnersLastMonth,
      activeOwners,
      blockedOwners,
    };
  }
}
