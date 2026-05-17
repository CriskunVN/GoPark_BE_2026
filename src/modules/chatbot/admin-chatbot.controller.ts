import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminChatbotService } from './admin-chatbot.service';
import { AuthGuard } from './guards/auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRoleEnum } from '../../common/enums/role.enum';

@Controller('chatbot/admin')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRoleEnum.ADMIN)
export class AdminChatbotController {
  constructor(private readonly adminChatbotService: AdminChatbotService) {}

  @Post('chat')
  async chat(@Body() body: any) {
    const messages = Array.isArray(body) ? body : body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return { text: 'Vui lòng gửi tin nhắn hợp lệ.' };
    }
    return this.adminChatbotService.processAdminMessage(messages);
  }

  @Get('sessions')
  async getSessions(@Req() req: Request) {
    const userId = (req as any).user?.sub ?? (req as any).user?.id;
    return this.adminChatbotService.getAdminSessions(userId);
  }

  @Post('sessions')
  async createSession(@Req() req: Request, @Body() body: any) {
    const userId = (req as any).user?.sub ?? (req as any).user?.id;
    return this.adminChatbotService.createAdminSession(userId, body?.title);
  }

  @Get('sessions/:id')
  async getSession(@Param('id') id: string, @Req() req: Request) {
    const userId = (req as any).user?.sub ?? (req as any).user?.id;
    return this.adminChatbotService.getAdminSession(id, userId);
  }

  @Delete('sessions/:id')
  async deleteSession(@Param('id') id: string, @Req() req: Request) {
    const userId = (req as any).user?.sub ?? (req as any).user?.id;
    return this.adminChatbotService.deleteAdminSession(id, userId);
  }

  @Post('sessions/:id/chat')
  async chatWithSession(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: Request,
  ) {
    const userId = (req as any).user?.sub ?? (req as any).user?.id;
    const messages = Array.isArray(body) ? body : body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return { text: 'Vui lòng gửi tin nhắn hợp lệ.' };
    }
    return this.adminChatbotService.processAdminMessageWithSession(
      messages,
      userId,
      id,
    );
  }
}
