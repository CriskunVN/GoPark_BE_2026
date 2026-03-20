import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { RequestService } from './request.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { UpdateRequestDto } from './dto/update-request.dto';
import { RequestResDto } from './dto/request-res.dto';

@Controller('request')
export class RequestController {
  constructor(private readonly requestService: RequestService) {}

  @Post()
  async create(
    @Body() createRequestDto: CreateRequestDto,
  ): Promise<{ message: string; data: RequestResDto }> {
    const data = await this.requestService.create(createRequestDto);
    return {
      message: 'Tạo yêu cầu thành công',
      data,
    };
  }
  @Get()
  async findAll(): Promise<{ message: string; data: RequestResDto[] }> {
    const data = await this.requestService.findAll();
    return {
      message: 'Lấy danh sách yêu cầu thành công',
      data,
    };
  }
}
