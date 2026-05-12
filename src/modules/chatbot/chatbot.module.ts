import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ChatbotService } from './chatbot.service';
import { ChatbotController } from './chatbot.controller';
import { OwnerChatbotController } from './owner-chatbot.controller';
import { OwnerChatbotService } from './owner-chatbot.service';
import { AuthGuard } from './guards/auth.guard';
import { OptionalAuthGuard } from './guards/optional-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ChatbotStateService } from './chatbot-state.service';

@Module({
  imports: [
    // ✅ Sử dụng ConfigService để đảm bảo JWT_ACCESS_SECRET giống với AuthModule
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_ACCESS_SECRET');
        if (!secret) {
          throw new Error('JWT_ACCESS_SECRET not found for ChatbotModule');
        }
        return {
          secret,
          signOptions: {
            expiresIn:
              configService.get<string>('JWT_ACCESS_EXPIRATION_TIME') || '15m',
          },
        } as any;
      },
      inject: [ConfigService],
    }),
  ],
  providers: [
    ChatbotService,
    OwnerChatbotService,
    AuthGuard,
    OptionalAuthGuard,
    RolesGuard,
    Reflector,
    ChatbotStateService,
  ],
  controllers: [ChatbotController, OwnerChatbotController],
  exports: [ChatbotService, OwnerChatbotService],
})
export class ChatbotModule {}
