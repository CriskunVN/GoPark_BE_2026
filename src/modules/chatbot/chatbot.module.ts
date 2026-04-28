import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ChatbotService } from './chatbot.service';
import { ChatbotController } from './chatbot.controller';
import { AuthGuard } from './guards/auth.guard';
import { OptionalAuthGuard } from './guards/optional-auth.guard';

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
            expiresIn: configService.get<string>('JWT_ACCESS_EXPIRATION_TIME') || '15m',
          },
        } as any;
      },
      inject: [ConfigService],
    }),
  ],
  providers: [ChatbotService, AuthGuard, OptionalAuthGuard],
  controllers: [ChatbotController],
  exports: [ChatbotService],
})
export class ChatbotModule {}