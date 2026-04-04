import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UploadedFiles,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ParkingLotService } from './parking-lot.service';
import { ParkingLotUserResDto } from './dto/parking-lot-user-res.dto';
import {
  OwnerParkingLotResDto,
  OwnerParkingLotTotalsResDto,
} from './dto/owner-parking-lot-res.dto';
import { CreateParkingLotReqDto } from './dto/create-parking-lot-req.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AnyFilesInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { BecomeOwnerDto } from './dto/become-owner.dto';
import { WalkInDto } from './dto/walk-in.dto';

// chia vung ra roi thay nghe

@Controller('parking-lots')
export class ParkingLotController {
  constructor(private readonly parkingLotService: ParkingLotService) {}

  // ─── Routes: owner (đặt TRƯỚC :parkingLotId để tránh route collision) ──────

  @Get('owner/:ownerId')
  async getParkingLotsByOwner(
    @Param('ownerId') ownerId: string,
  ): Promise<OwnerParkingLotResDto[]> {
    return this.parkingLotService.getParkingLotsByOwner(ownerId);
  }

  @Get('owner/:ownerId/totals')
  async getTotalsByOwner(
    @Param('ownerId') ownerId: string,
  ): Promise<OwnerParkingLotTotalsResDto> {
    return this.parkingLotService.getTotalsByOwner(ownerId);
  }

  // ─── Route: users of a specific parking lot ─────────────────────────────────

  @Get(':parkingLotId/users')
  async getUsersByParkingLot(
    @Param('parkingLotId', ParseIntPipe) parkingLotId: number,
    @Query('search') search?: string,
  ): Promise<ParkingLotUserResDto[]> {
    return this.parkingLotService.getUsersByParkingLot(parkingLotId, search);
  }


  //get bãi đỗ
  @UseGuards(JwtAuthGuard)
  @Get('map/:lotid')
  async getMapBooing(@Param('lotid') lotid : number,@Req() req : any) {
    const userId = req.user['userId'];
    return this.parkingLotService.getMapForBooking(lotid,userId);
  }

  //bãi đỗ gần nhất
  @Get('nearby/:lotid')
  async gethaversineParkingLot(
  @Param('lotid') lotid :number, 
  @Query('lat') lat: any, 
  @Query('lng') lng: any){
    
    const latitude = parseFloat(lat) || 0;
    const longitude = parseFloat(lng) || 0;
    return this.parkingLotService.haversineParkingLot(lotid,latitude,longitude)
  }

  // ─── Route: create parking lot (chỉ dành cho owner) ─────────────────────────
  @Post()
  async createParkingLot(@Body() createParkingLotDto: CreateParkingLotReqDto) {
    return this.parkingLotService.createParkingLot(createParkingLotDto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('become-owner')
  @UseInterceptors(AnyFilesInterceptor())
  async becomeOwner(
    @Req() req: any,
    @Body() dto: BecomeOwnerDto,
    @UploadedFiles() files: Array<Express.Multer.File>,
  ) {
    const userId = req.user['userId'];
    return this.parkingLotService.becomeOwner(userId, dto, files);
  }

  // ─── Route: Guest Check-in (Silent Registration) ─────────────────────────

  @Post('ocr')
  @UseInterceptors(FileInterceptor('image'))
  async extractLicensePlate(@UploadedFile() file: Express.Multer.File) {
    return await this.parkingLotService.extractLicensePlate(file);
  }

  @Post(':parkingLotId/walk-in')
  async handleWalkIn(
    @Param('parkingLotId', ParseIntPipe) parkingLotId: number,
    @Body() dto: WalkInDto,
  ) {
    return await this.parkingLotService.handleWalkIn(parkingLotId, dto);
  }

  //lấy comment
  @Get('comment/:lotid')
  async getComment(@Param('lotid') lotid : number){
    return await this.parkingLotService.getCommentUser(lotid)
  }
}
