import { Body, Controller, Get, Post, BadRequestException } from '@nestjs/common';
import { ChatbotService } from './chatbot.service';

@Controller('chatbot')
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Get('status')
  async status() {
    // returns status for Groq (llama) and Gemini-mini (if configured)
    const result = await this.chatbotService.checkModels();
    return { status: 'ok', running: true, models: result };
  }

  @Post('chat')
  async chat(@Body() body: any) {
    const messages = Array.isArray(body) ? body : body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new BadRequestException("'messages' must be a non-empty array");
    }

    const text = await this.chatbotService.complete(messages);
    return { message: text, data: { text } };
  }
}
