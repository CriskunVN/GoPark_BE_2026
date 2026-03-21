import { UseGuards, Controller, Post, Body, Req, UseInterceptors, UploadedFiles } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { ParkingService } from './parking.service';
import { BecomeOwnerDto } from './dto/become-owner.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('parking')
export class ParkingController {
  constructor(private readonly parkingService: ParkingService) {}

  @UseGuards(JwtAuthGuard)
  @Post('become-owner')
  @UseInterceptors(AnyFilesInterceptor())
  async becomeOwner(
    @Req() req: any, 
    @Body() dto: BecomeOwnerDto,
    @UploadedFiles() files: Array<Express.Multer.File>,
  ) {
    const userId = req.user['userId'];
    return this.parkingService.becomeOwner(userId, dto, files);
  }
}