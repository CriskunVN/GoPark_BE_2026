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
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResDto } from './dto/user-res.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
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
  // --------------------------------

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
