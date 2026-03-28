import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
} from '@nestjs/common';
import { RequestService } from './request.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { RequestResDto } from './dto/request-res.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('request')
export class RequestController {
  constructor(private readonly requestService: RequestService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @Req() req: any,
    @Body() createRequestDto: CreateRequestDto,
  ): Promise<{ message: string; data: RequestResDto }> {
    createRequestDto.requesterId = req.user['userId'];
    const data = await this.requestService.create(createRequestDto);
    return {
      message: 'Tạo yêu cầu thành công',
      data,
    };
  }
// Admin có thể xem tất cả yêu cầu với phân trang và lọc theo trạng thái
  @UseGuards(JwtAuthGuard)
  @Post('become-owner')
  async becomeOwner(
    @Req() req: any,
    @Body() payload: any,
  ): Promise<{ message: string; data: RequestResDto }> {
    const createRequestDto: CreateRequestDto = {
      type: 'BECOME_OWNER' as any,
      payload,
      // nếu payload có tên bãi đỗ thì mô tả sẽ là yêu cầu đăng ký trở thành chủ bãi đỗ với tên bãi đỗ, ngược lại sẽ là yêu cầu đăng ký trở thành chủ bãi đỗ chung chung
      description: payload.parkingLotName ? `Yêu cầu đăng ký trở thành chủ bãi đỗ: ${payload.parkingLotName}` : 'Yêu cầu đăng ký trở thành chủ bãi đỗ',
      requesterId: req.user['userId'],
    };
    const data = await this.requestService.create(createRequestDto);
    return {
      message: 'Gửi yêu cầu trở thành chủ bãi đỗ thành công',
      data,
    };
  }
// Người dùng có thể xem tất cả yêu cầu của mình
  @Get()
  async findAll(): Promise<{ message: string; data: RequestResDto[] }> {
    const data = await this.requestService.findAll();
    return {
      message: 'Lấy danh sách yêu cầu thành công',
      data,
    };
  }
// Người dùng có thể xem tất cả yêu cầu của mình
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async findMyRequests(
    @Req() req: any,
  ): Promise<{ message: string; data: RequestResDto[] }> {
    const data = await this.requestService.findAllByUser(req.user['userId']);
    return {
      message: 'Lấy danh sách yêu cầu cá nhân thành công',
      data,
    };
  }
}

