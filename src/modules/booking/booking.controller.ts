import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { BookingService } from './booking.service';
import { Booking } from './entities/booking.entity';
import { CreateBookingDto } from './dto/create.dto';
import { CreateQrcodeDto } from './dto/createQR.dto';

@Controller('booking')
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}
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
  async handleScan(@Body() data: { content: string; gateId: number }) {
    return await this.bookingService.scanQRCode(data.content, data.gateId);
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
