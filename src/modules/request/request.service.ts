import { Injectable } from '@nestjs/common';
import { CreateRequestDto } from './dto/create-request.dto';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from './entities/request.entity';
import { RequestResDto } from './dto/request-res.dto';
import { RequestStatus } from 'src/common/enums/status.enum';

@Injectable()
export class RequestService {
  constructor(
    @InjectRepository(Request)
    private requestRepository: Repository<Request>,
  ) {}

  async create(createRequestDto: CreateRequestDto) {
    const { requesterId, ...requestData } = createRequestDto;

    const request = this.requestRepository.create({
      ...requestData,
    });

    request.requester = { id: requesterId } as any;

    await this.requestRepository.save(request);
    return RequestResDto.fromEntity(request);
  }

  async findAll() {
    const requests = await this.requestRepository.find({
      relations: ['requester'],
      order: { createdAt: 'DESC' },
    });

    return RequestResDto.fromEntities(requests);
  }

  // Người dùng có thể xem tất cả yêu cầu của mình
  async findAllByStatus(status: string) {
    const requests = await this.requestRepository.find({
      where: { status },
      relations: ['requester'],
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

  updateStatusRequest(id: string, status: string) {
    if (
      RequestStatus[status.toUpperCase() as keyof typeof RequestStatus] ===
      undefined
    ) {
      throw new Error('Invalid status value');
    }

    return this.requestRepository.update(id, { status });
  }
}
