import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { InitConversationDto } from './dto/init-conversation.dto';
import { SupabaseService } from 'src/common/supabase/supabase.service';
import { PinMessageDto } from './dto/pin-message.dto';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly supabaseService: SupabaseService,
  ) {}

  private getAuthUserId(req: any): string {
    return req.user?.userId || req.user?.id;
  }

  @Post('conversations/init')
  async initConversation(@Req() req: any, @Body() dto: InitConversationDto) {
    const userId = this.getAuthUserId(req);
    return this.chatService.findOrCreateConversation(userId, dto.receiverId);
  }

  @Get('conversations')
  async getConversations(@Req() req: any) {
    const userId = this.getAuthUserId(req);
    return this.chatService.getConversations(userId);
  }

  @Get('messages/:conversationId')
  async getMessages(
    @Req() req: any,
    @Param('conversationId') conversationId: string,
  ) {
    const userId = this.getAuthUserId(req);
    return this.chatService.getMessagesForUser(userId, conversationId);
  }

  @Post('upload')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  async uploadAttachment(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Không có file để upload');
    }

    const fileUrl = await this.supabaseService.uploadFile(file, 'chat');

    const messageType = file.mimetype.startsWith('image/')
      ? 'IMAGE'
      : file.mimetype.startsWith('video/')
        ? 'VIDEO'
        : 'FILE';

    return {
      fileUrl,
      fileName: file.originalname,
      mimeType: file.mimetype,
      messageType,
    };
  }

  @Put('mark-read/:conversationId')
  async markAsRead(
    @Req() req: any,
    @Param('conversationId') conversationId: string,
  ) {
    const viewerId = this.getAuthUserId(req);
    return this.chatService.markAsRead(conversationId, viewerId);
  }

  @Put('pin/:conversationId')
  async pinMessage(
    @Req() req: any,
    @Param('conversationId') conversationId: string,
    @Body() dto: PinMessageDto,
  ) {
    const userId = this.getAuthUserId(req);
    return this.chatService.pinMessage(userId, conversationId, dto.messageId ?? null);
  }

  @Delete('conversations/:conversationId')
  async deleteConversation(
    @Req() req: any,
    @Param('conversationId') conversationId: string,
  ) {
    const userId = this.getAuthUserId(req);
    return this.chatService.deleteConversation(userId, conversationId);
  }
}
