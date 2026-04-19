import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { BookingService } from './booking.service';
import { Booking } from './entities/booking.entity';
import { CreateBookingDto } from './dto/create.dto';
import { CreateQrcodeDto } from './dto/createQR.dto';

@Controller('booking')
export class BookingController {
    constructor(private readonly bookingService:BookingService){}
    //Booking
    @Get()
    find(){
        return this.bookingService.getAllBooking();
    }

    @Get('user/:id')
    findByUser(@Param('id') userid:string){
        console.log("User ID:", userid);
        return this.bookingService.getBookingByUser(userid)
    }

    @Post()
    create(@Body() bookingdto:CreateBookingDto){
        return this.bookingService.createBooking(bookingdto)
    }

    @Post('scan')
    async handleScan(@Body() data: { content: string; gateId: number }) {
    return await this.bookingService.scanQRCode(data.content, data.gateId);
    }

    @Put(':id')
    update(@Param('id') id:number,@Body() bookingdto:CreateBookingDto){
        return this.bookingService.updateBooking(id,bookingdto)
    }

    @Delete(':id')
    delete(@Param('id') id:number){
        return this.bookingService.deleteBooking(id)
    }
    
    //send QR email
    @Post(':id/send-qr-email')
    async sendQREmail(@Param('id') id: number) {
    return this.bookingService.sendEmail(id);
    }
}
