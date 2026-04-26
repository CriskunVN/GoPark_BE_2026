import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Delete,
} from '@nestjs/common';
import { ParkingLotService } from './parking-lot.service';
import { ParkingLotUserResDto } from './dto/parking-lot-user-res.dto';
import {
  OwnerParkingLotResDto,
  OwnerParkingLotTotalsResDto,
} from './dto/owner-parking-lot-res.dto';
import { CreateParkingLotReqDto } from './dto/create-parking-lot-req.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRoleEnum } from '../../common/enums/role.enum';
import {
  AnyFilesInterceptor,
  FileInterceptor,
  FilesInterceptor,
} from '@nestjs/platform-express';
import { BecomeOwnerDto } from './dto/become-owner.dto';
import { WalkInDto } from './dto/walk-in.dto';
import { CreateFloorDto } from './dto/create-floor.dto';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { UpdateFloorDto } from './dto/update-floor.dto';
import { CheckAvailableSlotsDto } from './dto/check-available-slots.dto';
import { GetSlotAvailabilityDto } from './dto/get-slot-availability.dto';
import { ManualBookingDto } from './dto/manual-booking.dto';
import { UpdateParkingLotReqDto } from './dto/update-parking-lot-req.dto';
import { DeleteParkingLotImageDto } from './dto/delete-parking-lot-image.dto';

// chia vung ra roi thay nghe

@Controller('parking-lots')
export class ParkingLotController {
  constructor(private readonly parkingLotService: ParkingLotService) {}

  @Get('all')
  async getAllParkingLots() {
    return this.parkingLotService.getAllParkingLots();
  }

  @UseGuards(JwtAuthGuard)
  @Get('public/:lotid')
  async getPublicParkingLotDetail(
    @Param('lotid', ParseIntPipe) lotid: number,
    @Req() req: any
  ) {
    const userId = req.user?.userId;
    return this.parkingLotService.getPublicParkingLotDetail(lotid,userId);
  }

  // ─── Routes: owner (đặt TRƯỚC :parkingLotId để tránh route collision) ──────

  @Get('owner/:ownerId')
  async getParkingLotsByOwner(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
  ): Promise<OwnerParkingLotResDto[]> {
    return this.parkingLotService.getParkingLotsByOwner(ownerId);
  }

  @Get('owner/:ownerId/totals')
  async getTotalsByOwner(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
  ): Promise<OwnerParkingLotTotalsResDto> {
    return this.parkingLotService.getTotalsByOwner(ownerId);
  }

  // ─── Route: users of a specific parking lot ─────────────────────────────────

  @Get(':parkingLotId/users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoleEnum.OWNER, UserRoleEnum.STAFF)
  async getUsersByParkingLot(
    @Param('parkingLotId', ParseIntPipe) parkingLotId: number,
    @Req() req: any,
    @Query('search') search?: string,
  ): Promise<ParkingLotUserResDto[]> {
    return this.parkingLotService.getUsersByParkingLot(
      parkingLotId,
      req.user,
      search,
    );
  }
  // get bãi đỗ
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoleEnum.OWNER, UserRoleEnum.STAFF)
  @Get('map/:lotid')
  async getMapBooing(@Param('lotid') lotid: number, @Req() req: any) {
    const user = req.user;
    return this.parkingLotService.getMapForBooking(lotid, user);
  }

  // Lấy bản đồ bãi đỗ với trạng thái slot theo khung giờ (Cinema Style)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoleEnum.OWNER, UserRoleEnum.STAFF)
  @Get(':parkingLotId/available-map')
  async getAvailableMap(
    @Param('parkingLotId', ParseIntPipe) parkingLotId: number,
    @Query() dto: CheckAvailableSlotsDto,
    @Req() req: any,
  ) {
    const user = req.user;
    return this.parkingLotService.getAvailableMapByTime(
      parkingLotId,
      user,
      dto.start_time,
      dto.end_time,
    );
  }

  // Lấy lịch trình chi tiết của 1 Slot cụ thể trong 1 ngày
  @Get('slots/:slotId/availability')
  async getSlotAvailability(
    @Param('slotId', ParseIntPipe) slotId: number,
    @Query() dto: GetSlotAvailabilityDto,
  ) {
    return this.parkingLotService.getSlotAvailability(slotId, dto.date);
  }

  //bãi đỗ gần nhất
  @Get('nearby/:lotid')
  async gethaversineParkingLot(
    @Param('lotid') lotid: number,
    @Query('lat') lat: any,
    @Query('lng') lng: any,
  ) {
    const latitude = parseFloat(lat) || 0;
    const longitude = parseFloat(lng) || 0;
    return this.parkingLotService.haversineParkingLot(
      lotid,
      latitude,
      longitude,
    );
  }

  // ─── Route: create parking lot (chỉ dành cho owner) ─────────────────────────
  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FilesInterceptor('images'))
  async createParkingLot(
    @Req() req: any,
    @Body() createParkingLotDto: CreateParkingLotReqDto,
    @UploadedFiles() files?: Array<Express.Multer.File>,
  ) {
    if (!createParkingLotDto.ownerId) {
      createParkingLotDto.ownerId = req.user['userId'];
    }
    return this.parkingLotService.createParkingLot(createParkingLotDto, files);
  }

  // ─── Route: update parking lot (chỉ dành cho owner) ─────────────────────────
  @Patch(':parkingLotId')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FilesInterceptor('images'))
  async updateParkingLot(
    @Param('parkingLotId', ParseIntPipe) parkingLotId: number,
    @Body() updateParkingLotDto: UpdateParkingLotReqDto,
    @Req() req: any,
    @UploadedFiles() files?: Array<Express.Multer.File>,
  ) {
    return this.parkingLotService.updateParkingLot(
      parkingLotId,
      updateParkingLotDto,
      req.user,
      files,
    );
  }

  // ─── Route: delete a specific parking lot image (chỉ dành cho owner) ──────
  @Delete(':parkingLotId/images')
  @UseGuards(JwtAuthGuard)
  async deleteParkingLotImage(
    @Param('parkingLotId', ParseIntPipe) parkingLotId: number,
    @Body() dto: DeleteParkingLotImageDto,
    @Req() req: any,
  ) {
    return this.parkingLotService.deleteParkingLotImage(
      parkingLotId,
      req.user,
      dto.imageUrl,
    );
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
  async extractLicensePlate(
    @UploadedFile() file: Express.Multer.File,
    @Body('language') language?: string,
  ) {
    return await this.parkingLotService.extractLicensePlate(file, language);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoleEnum.OWNER, UserRoleEnum.STAFF)
  @Post(':parkingLotId/walk-in')
  async handleWalkIn(
    @Param('parkingLotId', ParseIntPipe) parkingLotId: number,
    @Body() dto: WalkInDto,
    @Req() req: any,
  ) {
    return await this.parkingLotService.handleWalkIn(
      parkingLotId,
      dto,
      req.user,
    );
  }

  // ─── Route: Manual Booking (Owner đặt chỗ thủ công) ─────────────────────────
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoleEnum.OWNER, UserRoleEnum.STAFF)
  @Post(':parkingLotId/manual-booking')
  async handleManualBooking(
    @Param('parkingLotId', ParseIntPipe) parkingLotId: number,
    @Body() dto: ManualBookingDto,
    @Req() req: any,
  ) {
    return await this.parkingLotService.handleManualBooking(
      parkingLotId,
      dto,
      req.user,
    );
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
  async getComment(@Param('lotid') lotid: number) {
    return await this.parkingLotService.getCommentUser(lotid);
  }

}
