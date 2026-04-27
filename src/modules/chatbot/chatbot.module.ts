import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ChatbotService } from './chatbot.service';
import { ChatbotController } from './chatbot.controller';
import { AuthGuard } from './guards/auth.guard';
import { OptionalAuthGuard } from './guards/optional-auth.guard';

@Module({
  imports: [
    // JwtModule để verify token trong guards
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET || 'gopark-secret-key-123',
      signOptions: {
        expiresIn: (process.env.JWT_ACCESS_EXPIRATION_TIME || '15m') as any,
      },
    }),
  ],
  providers: [ChatbotService, AuthGuard, OptionalAuthGuard],
  controllers: [ChatbotController],
  exports: [ChatbotService],
})
export class ChatbotModule {}
