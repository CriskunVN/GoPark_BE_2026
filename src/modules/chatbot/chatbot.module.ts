import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ChatbotService } from './chatbot.service';
import { ChatbotController } from './chatbot.controller';
import { OwnerChatbotController } from './owner-chatbot.controller';
import { OwnerChatbotService } from './owner-chatbot.service';
import { AdminChatbotController } from './admin-chatbot.controller';
import { AdminChatbotService } from './admin-chatbot.service';
import { AuthGuard } from './guards/auth.guard';
import { OptionalAuthGuard } from './guards/optional-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ChatbotStateService } from './chatbot-state.service';
import { ChatbotSession } from './entities/chatbot-session.entity';
import { ChatbotGuideService } from './chatbot-guide.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatbotSession]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_ACCESS_SECRET');
        if (!secret) throw new Error('JWT_ACCESS_SECRET not found for ChatbotModule');
        return {
          secret,
          signOptions: { expiresIn: configService.get<string>('JWT_ACCESS_EXPIRATION_TIME') || '15m' },
        } as any;
      },
      inject: [ConfigService],
    }),
  ],
  providers: [
    ChatbotService, OwnerChatbotService, AdminChatbotService, ChatbotGuideService,
    AuthGuard, OptionalAuthGuard, RolesGuard, Reflector, ChatbotStateService,
  ],
  controllers: [ChatbotController, OwnerChatbotController, AdminChatbotController],
  exports: [ChatbotService, OwnerChatbotService, AdminChatbotService],
})
export class ChatbotModule {}
