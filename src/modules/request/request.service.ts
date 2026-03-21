import { Injectable } from '@nestjs/common';
import { CreateRequestDto } from './dto/create-request.dto';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from './entities/request.entity';
import { RequestResDto } from './dto/request-res.dto';

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
      requester: { id: requesterId } as any,
    });

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
}
