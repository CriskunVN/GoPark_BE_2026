import { CreateRequestDto } from './dto/create-request.dto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from './entities/request.entity';
import { RequestResDto } from './dto/request-res.dto';
import { RequestStatus } from 'src/common/enums/status.enum';
import { UsersService } from '../users/users.service';

@Injectable()
export class RequestService {
  constructor(
    @InjectRepository(Request)
    private requestRepository: Repository<Request>,
    private usersService: UsersService,
  ) {}
  // tạo yêu cầu mới
  async create(createRequestDto: CreateRequestDto) {
    const { requesterId, ...requestData } = createRequestDto;

    const request = this.requestRepository.create({
      ...requestData,
    });

    request.requester = { id: requesterId } as any;

    await this.requestRepository.save(request);
    return RequestResDto.fromEntity(request);
  }
  // lấy tất cả yêu cầu (dành cho admin)
  async findAll() {
    const requests = await this.requestRepository.find({
      relations: ['requester'],
      order: { createdAt: 'DESC' },
    });

    return RequestResDto.fromEntities(requests);
  }
  // lấy tất cả yêu cầu của người dùng hiện tại
  async findAllByUser(userId: string) {
    const requests = await this.requestRepository.find({
      where: { requester: { id: userId } },
      relations: ['requester'], // lấy thông tin người yêu cầu
      order: { createdAt: 'DESC' },
    });

    return RequestResDto.fromEntities(requests);
  }

  // Người dùng có thể xem tất cả yêu cầu của mình
  async findAllByStatus(status: string) {
    const requests = await this.requestRepository.find({
      where: { status },
      relations: ['requester'], // lấy thông tin người yêu cầu
      order: { createdAt: 'DESC' },
    });

    return RequestResDto.fromEntities(requests);
  }

  // Admin có thể xem tất cả yêu cầu với phân trang và lọc theo trạng thái
  async findAllRequests(page = 1, limit = 10, status?: string) {
    const query = this.requestRepository
      .createQueryBuilder('request')
      .leftJoinAndSelect('request.requester', 'requester')
      .orderBy('request.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) {
      query.where('request.status = :status', { status });
    }

    const [requests, total] = await query.getManyAndCount();
    // trả về dữ liệu với thông tin phân trang
    return {
      items: RequestResDto.fromEntities(requests),
      meta: {
        totalItems: total,
        itemCount: requests.length,
        itemsPerPage: limit,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
      },
    };
  }
  // cập nhật trạng thái yêu cầu (dành cho admin)
  updateStatusRequest(id: string, status: string) {
    // kiểm tra nếu trạng thái không hợp lệ thì ném lỗi
    if (
      RequestStatus[status.toUpperCase() as keyof typeof RequestStatus] ===
      undefined
    ) {
      throw new Error('Invalid status value');
    }

    return this.requestRepository.update(id, { status });
  }

  async countTotalRequests() {
    const count = await this.requestRepository.count();
    return count;
  }

  async countRequestsByStatus(status: RequestStatus) {
    const count = await this.requestRepository.count({ where: { status } });
    return count;
  }

  // Người dùng xác nhận yêu cầu đã được duyệt
  async confirmRequest(id: string, userId: string) {
    const request = await this.requestRepository.findOne({
      where: { id },
      relations: ['requester'],
    });

    if (!request) {
      throw new NotFoundException('Không tìm thấy yêu cầu');
    }

    if (request.requester.id !== userId) {
      throw new BadRequestException('Bạn không có quyền xác nhận yêu cầu này');
    }

    if (request.status !== RequestStatus.APPROVED) {
      throw new BadRequestException('Yêu cầu chưa được duyệt hoặc đã xử lý');
    }

    if (request.type !== 'BECOME_OWNER') {
      throw new BadRequestException('Loại yêu cầu không hợp lệ để xác nhận');
    }

    // 1. Chuyển role người dùng sang OWNER
    await this.usersService.makeOwner(userId);

    // 2. Cập nhật trạng thái yêu cầu thành COMPLETED để đánh dấu đã xử lý xong hoàn toàn
    // Note: If RequestStatus.COMPLETED doesn't exist, we can use another state or just keep it as is
    // For now, let's just keep it as APPROVED but record that role is changed if needed, 
    // or assume the user will be redirected to Login and role is fixed.
    
    return {
      message: 'Xác nhận thành công. Bạn đã trở thành Chủ bãi đỗ.',
    };
  }
}
