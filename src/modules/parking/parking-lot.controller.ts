import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ParkingLotService } from './parking-lot.service';
import { ParkingLotUserResDto } from './dto/parking-lot-user-res.dto';
import {
  OwnerParkingLotResDto,
  OwnerParkingLotTotalsResDto,
} from './dto/owner-parking-lot-res.dto';

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
}
