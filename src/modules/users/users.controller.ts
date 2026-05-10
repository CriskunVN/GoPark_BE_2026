import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  UseGuards,
  Req,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  ParseIntPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResDto } from './dto/user-res.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRoleEnum } from '../../common/enums/role.enum';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  async create(@Body() createUserDto: CreateUserDto): Promise<UserResDto> {
    const user = await this.usersService.create(createUserDto);
    return UserResDto.fromEntity(user);
  }

  @Get()
  async findAll(): Promise<UserResDto[]> {
    const users = await this.usersService.findAll();
    return UserResDto.fromEntities(users);
  }

  // --- LOGGED IN USER ENDPOINTS ---
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@Req() req: any): Promise<UserResDto> {
    const user = await this.usersService.findOne(req.user['userId']);
    return UserResDto.fromEntity(user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me/profile')
  async updateProfile(
    @Req() req: any,
    @Body() updateProfileDto: UpdateProfileDto,
  ): Promise<UserResDto> {
    const user = await this.usersService.updateProfile(
      req.user['userId'],
      updateProfileDto,
    );
    return UserResDto.fromEntity(user);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatar(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<UserResDto> {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn ảnh đại diện');
    }

    if (!file.mimetype?.startsWith('image/')) {
      throw new BadRequestException('Chỉ hỗ trợ file ảnh');
    }

    if (file.size > 2 * 1024 * 1024) {
      throw new BadRequestException('Vui lòng chọn ảnh nhỏ hơn 2MB');
    }

    const user = await this.usersService.uploadAvatar(req.user['userId'], file);
    return UserResDto.fromEntity(user);
  }
  // --------------------------------

  // --- OWNER: Tạo tài khoản nhân viên (STAFF) ---
  // Yêu cầu đăng nhập + có role OWNER, tái sử dụng UsersService.create() với role STAFF
  @Post('staff')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoleEnum.OWNER)
  async createStaff(@Body() dto: CreateStaffDto): Promise<UserResDto> {
    const user = await this.usersService.createStaff(dto);
    return UserResDto.fromEntity(user);
  }

  @Get('staff/lot/:parkingLotId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoleEnum.OWNER)
  async getStaffByLot(
    @Param('parkingLotId', ParseIntPipe) parkingLotId: number,
  ): Promise<UserResDto[]> {
    const users = await this.usersService.findStaffByParkingLot(parkingLotId);
    return UserResDto.fromEntities(users);
  }

  @Delete('staff/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoleEnum.OWNER)
  @HttpCode(204)
  async removeStaff(@Param('id') id: string, @Req() req: any) {
    const ownerId = req.user['userId'];
    return this.usersService.removeStaff(id, ownerId);
  }
  // ------------------------------------------------

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<UserResDto> {
    const user = await this.usersService.findOne(id);
    return UserResDto.fromEntity(user);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<UserResDto> {
    const user = await this.usersService.update(id, updateUserDto);
    return UserResDto.fromEntity(user);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
