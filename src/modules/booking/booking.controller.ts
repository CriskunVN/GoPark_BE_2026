import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
  ParseIntPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { BookingService } from './booking.service';
import { Booking } from './entities/booking.entity';
import { CreateBookingDto } from './dto/create.dto';
import { CreateQrcodeDto } from './dto/createQR.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { ParkingLotService } from '../parking-lot/parking-lot.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRoleEnum } from '../../common/enums/role.enum';
import { Req, UseGuards } from '@nestjs/common';

@Controller('booking')
export class BookingController {
  constructor(
    private readonly bookingService: BookingService,
    private readonly parkingLotService: ParkingLotService,
  ) {}
  //Booking
  @Get()
  find() {
    return this.bookingService.getAllBooking();
  }


  @Get('user/:id')
  findByUser(@Param('id') userid: string) {
    //console.log('User ID:', userid);
    return this.bookingService.getBookingByUser(userid);
  }

  
  @UseGuards(JwtAuthGuard)
  @Get('active-by-vehicle/:vehicleId')
  async getActiveBooking(
    @Param('vehicleId') vehicleId: number, 
    @Req() req: any
  ) {
    // Property name from JwtStrategy is userId
    const userId = req.user.userId; 
    
    //console.log(">>> [BE] Đã nhận diện User ID:", userId); 
    //console.log("Vehicle ID:", vehicleId);
    
    return this.bookingService.getLatestActiveBooking(Number(vehicleId), userId);
  }

  @Get('active/slot/:slotId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoleEnum.OWNER, UserRoleEnum.STAFF)
  async getActiveBookingBySlot(@Param('slotId', ParseIntPipe) slotId: number) {
    return this.bookingService.getActiveBookingBySlot(slotId);
  }

  // ================= OWNER ANALYTICS =================
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoleEnum.OWNER)
  @Get('owner-analytics/me/metrics')
  getOwnerMetrics(
    @Req() req: any,
    @Query('lotId') lotId?: number,
  ) {
    const ownerId = req.user.userId;
    return this.bookingService.getOwnerMetrics(
      ownerId,
      lotId ? Number(lotId) : undefined,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoleEnum.OWNER)
  @Get('owner-analytics/me/revenue-by-month')
  getRevenueByMonth(
    @Req() req: any,
    @Query('year') year?: number,
    @Query('lotId') lotId?: number,
  ) {
    const ownerId = req.user.userId;
    const queryYear = year ? Number(year) : new Date().getFullYear();
    return this.bookingService.getRevenueByMonth(
      ownerId,
      queryYear,
      lotId ? Number(lotId) : undefined,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoleEnum.OWNER)
  @Get('owner-analytics/me/payment-methods')
  getPaymentMethodStats(
    @Req() req: any,
    @Query('lotId') lotId?: number,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const ownerId = req.user.userId;
    return this.bookingService.getPaymentMethodStats(
      ownerId,
      lotId ? Number(lotId) : undefined,
      startDate,
      endDate,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoleEnum.OWNER)
  @Get('owner-analytics/me/hourly-traffic')
  getHourlyTraffic(
    @Req() req: any,
    @Query('lotId') lotId?: number,
    @Query('date') date?: string,
  ) {
    const ownerId = req.user.userId;
    return this.bookingService.getHourlyTraffic(
      ownerId,
      lotId ? Number(lotId) : undefined,
      date,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoleEnum.OWNER)
  @Get('owner-analytics/me/top-parking-lots')
  getTopParkingLots(
    @Req() req: any,
  ) {
    const ownerId = req.user.userId;
    return this.bookingService.getTopParkingLots(ownerId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoleEnum.OWNER)
  @Get('owner-analytics/me/recent-transactions')
  getRecentTransactions(
    @Req() req: any,
    @Query('lotId') lotId?: number,
    @Query('limit') limit?: number,
  ) {
    const ownerId = req.user.userId;
    return this.bookingService.getRecentTransactions(
      ownerId,
      lotId ? Number(lotId) : undefined,
      limit ? Number(limit) : 5,
    );
  }

  @Get('parking-lot/:lotId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoleEnum.OWNER, UserRoleEnum.STAFF)
  async findByParkingLot(
    @Param('lotId', ParseIntPipe) lotId: number,
    @Req() req: any,
    @Query('search') search?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.bookingService.getBookingByParkingLot(
      lotId,
      req.user,
      search,
      startDate,
      endDate,
    );
  }

  @Post()
  create(@Body() bookingdto: CreateBookingDto) {
    return this.bookingService.createBooking(bookingdto);
  }

  @Post('scan')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoleEnum.OWNER, UserRoleEnum.STAFF)
  @UseInterceptors(FileInterceptor('image'))
  async handleScan(
    @Body() data: { content: string; gateId: string },
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    // 1. Gọi hàm OCR của bạn Dũng để lấy text từ ảnh (Gửi ảnh sang bên thứ 3)
    const plateText = await this.parkingLotService.extractLicensePlate(file);

    // 2. Truyền plateText vào logic so khớp và check-in
    return await this.bookingService.scanQRCode(
      data.content,
      Number(data.gateId),
      plateText,
      req.user,
    );
  }

  // gia hạn booking
  @Patch(':id/extend')
  async extendBooking(
    @Param('id') id: number,
    @Body() extendDto: { new_end_time: string, isPreview?: boolean }
  ) {
    return this.bookingService.extendBooking(id, extendDto);
  }


  @Put(':id')
  update(@Param('id') id: number, @Body() bookingdto: CreateBookingDto) {
    return this.bookingService.updateBooking(id, bookingdto);
  }

  @Delete(':id')
  delete(@Param('id') id: number) {
    return this.bookingService.deleteBooking(id);
  }

  //send QR email
  @Post(':id/send-qr-email')
  async sendQREmail(@Param('id') id: number) {
    return this.bookingService.sendEmail(id);
  }
}
