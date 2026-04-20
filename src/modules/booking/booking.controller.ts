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
} from '@nestjs/common';
import { BookingService } from './booking.service';
import { Booking } from './entities/booking.entity';
import { CreateBookingDto } from './dto/create.dto';
import { CreateQrcodeDto } from './dto/createQR.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { ParkingLotService } from '../parking-lot/parking-lot.service';

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
    console.log('User ID:', userid);
    return this.bookingService.getBookingByUser(userid);
  }

  // ================= OWNER ANALYTICS =================
  @Get('owner-analytics/:ownerId/metrics')
  getOwnerMetrics(
    @Param('ownerId') ownerId: string,
    @Query('lotId') lotId?: number,
  ) {
    return this.bookingService.getOwnerMetrics(
      ownerId,
      lotId ? Number(lotId) : undefined,
    );
  }

  @Get('owner-analytics/:ownerId/revenue-by-month')
  getRevenueByMonth(
    @Param('ownerId') ownerId: string,
    @Query('year') year?: number,
    @Query('lotId') lotId?: number,
  ) {
    const queryYear = year ? Number(year) : new Date().getFullYear();
    return this.bookingService.getRevenueByMonth(
      ownerId,
      queryYear,
      lotId ? Number(lotId) : undefined,
    );
  }

  @Get('parking-lot/:lotId')
  findByParkingLot(
    @Param('lotId') lotId: string,
    @Query('search') search?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.bookingService.getBookingByParkingLot(
      Number(lotId),
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
  @UseInterceptors(FileInterceptor('image'))
  async handleScan(
    @Body() data: { content: string; gateId: string },
    @UploadedFile() file: Express.Multer.File,
  ) {
    // 1. Gọi hàm OCR của bạn Dũng để lấy text từ ảnh (Gửi ảnh sang bên thứ 3)
    const plateText = await this.parkingLotService.extractLicensePlate(file);

    // 2. Truyền plateText vào logic so khớp và check-in
    return await this.bookingService.scanQRCode(data.content, Number(data.gateId), plateText);
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
