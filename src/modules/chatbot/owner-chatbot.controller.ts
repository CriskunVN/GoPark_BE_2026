import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import type { Request } from 'express';
import { OwnerChatbotService } from './owner-chatbot.service';
import { AuthGuard } from './guards/auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRoleEnum } from '../../common/enums/role.enum';

@Controller('chatbot/owner')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRoleEnum.OWNER)
export class OwnerChatbotController {
  constructor(private readonly ownerChatbotService: OwnerChatbotService) {}

  @Post('chat')
  async chat(@Body() body: any, @Req() req: Request) {
    const userId = (req as any).user?.sub ?? (req as any).user?.id;
    const messages = Array.isArray(body) ? body : body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return { text: 'Vui lòng gửi tin nhắn hợp lệ.' };
    }
    return this.ownerChatbotService.processOwnerMessage(messages, userId);
  }
}
