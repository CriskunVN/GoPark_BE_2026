import {
  Body,
  Controller,
  Get,
  Post,
  BadRequestException,
  UseGuards,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ChatbotService } from './chatbot.service';
import { AuthGuard } from './guards/auth.guard';
import { OptionalAuthGuard } from './guards/optional-auth.guard';

@Controller('chatbot')
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  // ─── Health check (yêu cầu đăng nhập) ────────────────────────────────────
  @Get('status')
  @UseGuards(AuthGuard)
  async status() {
    const result = await this.chatbotService.checkModels();
    return { status: 'ok', running: true, models: result };
  }

  // ─── Chat thường (không bắt buộc đăng nhập) ──────────────────────────────
  // Nếu đã đăng nhập → có userId → có thể query DB
  // Nếu chưa đăng nhập → vẫn dùng được AI cho câu hỏi thường
  @Post('chat')
  @UseGuards(OptionalAuthGuard)
  async chat(
    @Body() body: { messages: { role: string; content: string }[] },
    @Req() req: Request,
  ) {
    const messages = this.parseMessages(body);
    const userId = (req as any).user?.sub ?? (req as any).user?.id ?? undefined;

    const text = await this.chatbotService.complete(messages, userId);
    return { message: text, data: { text } };
  }

  // ─── SSE stream endpoint ──────────────────────────────────────────────────
  @Post('stream')
  @UseGuards(OptionalAuthGuard)
  async stream(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    const messages = this.parseMessages(body);
    const userId = (req as any).user?.sub ?? (req as any).user?.id ?? undefined;

    await this.chatbotService.streamToResponse(messages, res, userId);
  }

  // ─── Helper ───────────────────────────────────────────────────────────────
  private parseMessages(body: any): any[] {
    const messages = Array.isArray(body) ? body : body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new BadRequestException("'messages' must be a non-empty array");
    }
    return messages;
  }
}
