import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
} from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto, UpdateVehicleDto } from './dto/vehicle.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Post()
  create(@Req() req: any, @Body() createVehicleDto: CreateVehicleDto) {
    return this.vehiclesService.create(req.user['userId'], createVehicleDto);
  }

  @Get()
  findAll(@Req() req: any) {
    return this.vehiclesService.findAllByUser(req.user['userId']);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.vehiclesService.findOne(+id, req.user['userId']);
  }

  @Patch(':id')
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() updateVehicleDto: UpdateVehicleDto,
  ) {
    return this.vehiclesService.update(+id, req.user['userId'], updateVehicleDto);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.vehiclesService.remove(+id, req.user['userId']);
  }
}
