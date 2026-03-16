import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResDto } from './dto/user-res.dto';

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
