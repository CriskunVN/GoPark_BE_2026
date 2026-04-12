import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
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
import { CreateFloorDto } from './dto/create-floor.dto';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { UpdateFloorDto } from './dto/update-floor.dto';
import { CheckAvailableSlotsDto } from './dto/check-available-slots.dto';


// chia vung ra roi thay nghe

@Controller('parking-lots')
export class ParkingLotController {
  constructor(private readonly parkingLotService: ParkingLotService) {}

  @Get('all')
  async getAllParkingLots() {
    return this.parkingLotService.getAllParkingLots();
  }

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
  // get bãi đỗ
  @UseGuards(JwtAuthGuard)
  @Get('map/:lotid')
  async getMapBooing(@Param('lotid') lotid: number, @Req() req: any) {
    const userId = req.user['userId'];
    return this.parkingLotService.getMapForBooking(lotid, userId);
  }

  // Lấy bản đồ bãi đỗ với trạng thái slot theo khung giờ (Cinema Style)
  @UseGuards(JwtAuthGuard)
  @Get(':parkingLotId/available-map')
  async getAvailableMap(
    @Param('parkingLotId', ParseIntPipe) parkingLotId: number,
    @Query() dto: CheckAvailableSlotsDto,
    @Req() req: any,
  ) {
    const userId = req.user['userId'];
    return this.parkingLotService.getAvailableMapByTime(
      parkingLotId,
      userId,
      dto.start_time,
      dto.end_time,
    );
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

  // ─── Customization Endpoints (Floors & Zones) ─────────────────────────────

  @Get(':parkingLotId/floors')
  async getFloorsByParkingLot(
    @Param('parkingLotId', ParseIntPipe) parkingLotId: number,
  ) {
    return await this.parkingLotService.getFloorsByParkingLot(parkingLotId);
  }

  @Get(':parkingLotId/floors/:floorId/zones')
  async getZonesByFloor(
    @Param('parkingLotId', ParseIntPipe) parkingLotId: number,
    @Param('floorId', ParseIntPipe) floorId: number,
  ) {
    return await this.parkingLotService.getZonesByFloor(parkingLotId, floorId);
  }

  @Post(':parkingLotId/floors')
  async createFloor(
    @Param('parkingLotId', ParseIntPipe) parkingLotId: number,
    @Body() dto: CreateFloorDto,
  ) {
    return await this.parkingLotService.createFloor(parkingLotId, dto);
  }

  @Patch(':parkingLotId/floors/:floorId')
  async updateFloor(
    @Param('parkingLotId', ParseIntPipe) parkingLotId: number,
    @Param('floorId', ParseIntPipe) floorId: number,
    @Body() dto: UpdateFloorDto,
  ) {
    return await this.parkingLotService.updateFloor(parkingLotId, floorId, dto);
  }

  @Post('floors/:floorId/zones')
  async createZone(
    @Param('floorId', ParseIntPipe) floorId: number,
    @Body() dto: CreateZoneDto,
  ) {
    return await this.parkingLotService.createZone(floorId, dto);
  }

  @Patch(':parkingLotId/floors/:floorId/zones/:zoneId')
  async updateZone(
    @Param('parkingLotId', ParseIntPipe) parkingLotId: number,
    @Param('floorId', ParseIntPipe) floorId: number,
    @Param('zoneId', ParseIntPipe) zoneId: number,
    @Body() dto: UpdateZoneDto,
  ) {
    return await this.parkingLotService.updateZone(
      parkingLotId,
      floorId,
      zoneId,
      dto,
    );
  }

  // ─── Generate / Sync Slots ─────────────────────────────────────────────────

  /**
   * [POST] /parking-lots/:lotId/generate-slots
   * Generate hoặc sync toàn bộ slots của Lot (tất cả floors + zones).
   * Dùng cho nút "Hoàn tất cấu hình" trên FE.
   */
  @Post(':parkingLotId/generate-slots')
  async generateSlotsForLot(
    @Param('parkingLotId', ParseIntPipe) parkingLotId: number,
  ) {
    return await this.parkingLotService.generateSlotsForLot(parkingLotId);
  }

  /**
   * [POST] /parking-lots/:lotId/floors/:floorId/generate-slots
   * Generate hoặc sync slots cho 1 Floor cụ thể.
   */
  @Post(':parkingLotId/floors/:floorId/generate-slots')
  async generateSlotsForFloor(
    @Param('parkingLotId', ParseIntPipe) parkingLotId: number,
    @Param('floorId', ParseIntPipe) floorId: number,
  ) {
    return await this.parkingLotService.generateSlotsForFloor(
      parkingLotId,
      floorId,
    );
  }

  /**
   * [POST] /parking-lots/:lotId/floors/:floorId/zones/:zoneId/generate-slots
   * Generate hoặc sync slots cho 1 Zone cụ thể (granular nhất).
   */
  @Post(':parkingLotId/floors/:floorId/zones/:zoneId/generate-slots')
  async generateSlotsForZone(
    @Param('parkingLotId', ParseIntPipe) parkingLotId: number,
    @Param('floorId', ParseIntPipe) floorId: number,
    @Param('zoneId', ParseIntPipe) zoneId: number,
  ) {
    return await this.parkingLotService.generateSlotsForZone(
      parkingLotId,
      floorId,
      zoneId,
    );
  }

  /**
   * [GET] /parking-lots/:lotId/floors/:floorId/zones/:zoneId/slots
   * Xem danh sách slots của 1 Zone (để preview trên UI).
   * Query param: includeDisabled=true để xem cả slot DISABLED.
   */
  @Get(':parkingLotId/floors/:floorId/zones/:zoneId/slots')
  async getSlotsByZone(
    @Param('parkingLotId', ParseIntPipe) parkingLotId: number,
    @Param('floorId', ParseIntPipe) floorId: number,
    @Param('zoneId', ParseIntPipe) zoneId: number,
    @Query('includeDisabled') includeDisabled?: string,
  ) {
    return await this.parkingLotService.getSlotsByZone(
      parkingLotId,
      floorId,
      zoneId,
      includeDisabled === 'true',
    );
  }

  //lấy comment
  @Get('comment/:lotid')
  async getComment(@Param('lotid') lotid : number){
    return await this.parkingLotService.getCommentUser(lotid)
  }
}
