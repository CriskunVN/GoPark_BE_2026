import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { BookingService } from './booking.service';
import { Booking } from './entities/booking.entity';
import { CreateBookingDto } from './dto/create.dto';
import { CreateQrcodeDto } from './dto/createQR.dto';

@Controller('booking')
export class BookingController {
    constructor(private readonly bookingServer:BookingService){}

    //Booking
    @Get()
    find(){
        return this.bookingServer.getAllBooking();
    }

    @Get('user/:id')
    findByUser(@Param('id') userid:string){
        console.log("User ID:", userid);
        return this.bookingServer.getBookingByUser(userid)
    }

    @Post()
    create(@Body() bookingdto:CreateBookingDto){
        return this.bookingServer.createBooking(bookingdto)
    }

    @Put(':id')
    update(@Param('id') id:number,@Body() bookingdto:CreateBookingDto){
        return this.bookingServer.updateBooking(id,bookingdto)
    }

    @Delete(':id')
    delete(@Param('id') id:number){
        return this.bookingServer.deleteBooking(id)
    }

    //QRcode

    @Get('qrcode')
    findQRcode(){
        return this.bookingServer.getAllQRcode();
    }

    @Post('qrcode')
    createQRcode(@Body() qrcodedto:CreateQrcodeDto){
        return this.bookingServer.createQRcode(qrcodedto)
    }

    
}
