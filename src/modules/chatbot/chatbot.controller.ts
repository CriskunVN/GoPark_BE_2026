import {
  Body,
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
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

  // ─── Health check (public) ───────────────────────────────────────────────
  @Get('status')
  async status() {
    const result = await this.chatbotService.checkModels();
    return { status: 'ok', running: true, models: result };
  }

  // ─── Chat thường (không bắt buộc đăng nhập) ──────────────────────────────
  // Nếu đã đăng nhập → có userId → có thể query DB
  // Nếu chưa đăng nhập → vẫn dùng được AI cho câu hỏi thường
  @Post('chat')
  @UseGuards(OptionalAuthGuard)
  async chat(@Body() body: any, @Req() req: Request) {
    const messages = this.parseMessages(body);
    const context = body?.context ?? null;
    const userId = (req as any).user?.sub ?? (req as any).user?.id;
    const result = await this.chatbotService.processMessage(messages, userId, context);
    return result; // { text, action, data }
  }

  // ─── Đặt bãi từ form (endpoint riêng) ────────────────────────────────────
  @Post('book')
  @UseGuards(AuthGuard)
  async book(@Body() body: any, @Req() req: Request) {
    const userId = (req as any).user?.sub ?? (req as any).user?.id;

    if (!userId) {
      throw new BadRequestException('Cần đăng nhập để đặt bãi');
    }

    const { parkingLotId, startTime, endTime, vehicleId, paymentMethod } = body;

    if (
      !parkingLotId ||
      !startTime ||
      !endTime ||
      !vehicleId ||
      !paymentMethod
    ) {
      throw new BadRequestException('Thiếu thông tin đặt bãi');
    }

    try {
      const result = await this.chatbotService.createBookingFromForm(
        { parkingLotId, startTime, endTime, vehicleId, paymentMethod },
        userId,
      );

      return {
        text: `✅ Đã tạo đơn đặt chỗ #${result.bookingId}\n💰 Tổng tiền: ${result.totalAmount.toLocaleString('vi-VN')}đ\n🔄 Đang chuyển sang trang thanh toán...`,
        action: 'redirect',
        data: { url: result.redirectUrl },
      };
    } catch (error) {
      throw new BadRequestException((error as any)?.message || String(error));
    }
  }

  // ─── SSE stream endpoint ──────────────────────────────────────────────────
  @Post('stream')
  @UseGuards(OptionalAuthGuard)
  async stream(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    const messages = this.parseMessages(body);
    const userId = (req as any).user?.sub ?? (req as any).user?.id ?? undefined;
    await this.chatbotService.streamToResponse(messages, res, userId);
  }
  @Get('suggestions')
  async getSuggestions() {
    return {
      suggestions: [
        '🔍 Tìm bãi gần tôi',
        '💰 Bãi giá rẻ nhất',
        '⭐ Bãi phù hợp nhất với tôi',
        '📅 Đặt bãi',
        '📋 Lịch sử đặt của tôi',
        '💳 Số dư ví GoPark',
        '❓ Hướng dẫn thanh toán',
        '📞 Liên hệ hỗ trợ',
      ],
    };
  }

  // ─── Session management ───────────────────────────────────────────────────
  @Get('sessions')
  @UseGuards(AuthGuard)
  async getSessions(@Req() req: Request) {
    const userId = (req as any).user?.sub ?? (req as any).user?.id;
    return this.chatbotService.getUserSessions(userId);
  }

  @Post('sessions')
  @UseGuards(AuthGuard)
  async createSession(@Req() req: Request, @Body() body: any) {
    const userId = (req as any).user?.sub ?? (req as any).user?.id;
    return this.chatbotService.createSession(userId, body?.title);
  }

  @Get('sessions/:id')
  @UseGuards(AuthGuard)
  async getSession(@Param('id') id: string, @Req() req: Request) {
    const userId = (req as any).user?.sub ?? (req as any).user?.id;
    return this.chatbotService.getSession(id, userId);
  }

  @Patch('sessions/:id')
  @UseGuards(AuthGuard)
  async updateSession(@Param('id') id: string, @Req() req: Request, @Body() body: any) {
    const userId = (req as any).user?.sub ?? (req as any).user?.id;
    return this.chatbotService.updateSession(id, userId, body);
  }

  @Delete('sessions/:id')
  @UseGuards(AuthGuard)
  async deleteSession(@Param('id') id: string, @Req() req: Request) {
    const userId = (req as any).user?.sub ?? (req as any).user?.id;
    return this.chatbotService.deleteSession(id, userId);
  }

  // ─── Chat với session ─────────────────────────────────────────────────────
  @Post('sessions/:id/chat')
  @UseGuards(AuthGuard)
  async chatWithSession(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const userId = (req as any).user?.sub ?? (req as any).user?.id;
    const messages = this.parseMessages(body);
    const context = body?.context ?? null;
    const result = await this.chatbotService.processMessageWithSession(messages, userId, id, context);
    return result;
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
