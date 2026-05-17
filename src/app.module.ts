import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getDatabaseConfig } from './config/database/database.config';

import { UsersModule } from './modules/users/users.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { ParkingModule } from './modules/parking-lot/parking-lot.module';
import { BookingModule } from './modules/booking/booking.module';
import { PaymentModule } from './modules/payment/payment.module';
import { AuthModule } from './modules/auth/auth.module';
import { DataSource } from 'typeorm';
import { AdminModule } from './modules/admin/admin.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { RequestModule } from './modules/request/request.module';
import { NotificationModule } from './modules/notification/notification.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { ChatModule } from './modules/chat/chat.module';
import { BullModule } from '@nestjs/bull';
import { SupabaseModule } from './common/supabase/supabase.module';
import { ScheduleModule } from '@nestjs/schedule';
import { VoucherModule } from './modules/voucher/voucher.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { ChatbotModule } from './modules/chatbot/chatbot.module';

@Module({
  imports: [
    BullModule.forRoot({
      redis: process.env.REDIS_URL,
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      // the .env file lives under src/, adjust path accordingly
      envFilePath: ['.env', 'src/.env'],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: getDatabaseConfig,
    }),
    AuthModule,
    UsersModule,
    VehiclesModule,
    WalletModule,
    ParkingModule,
    BookingModule,
    PaymentModule,
    AdminModule,
    RequestModule,
    NotificationModule,
    AnalyticsModule,
    SupabaseModule,
    ChatModule,
    VoucherModule,
    ScheduleModule.forRoot(),
    ReviewsModule,
    ChatbotModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {
  constructor(private dataSource: DataSource) {}
  async onModuleInit() {
    if (this.dataSource.isInitialized) {
      console.log('Database connection successfully.');
      try {
        await this.dataSource.query(`
          ALTER TABLE parking_lots 
          ALTER COLUMN open_time TYPE time WITHOUT TIME ZONE USING open_time::time,
          ALTER COLUMN close_time TYPE time WITHOUT TIME ZONE USING close_time::time;
        `);
        console.log('Successfully altered parking_lots columns open_time and close_time to TIME.');
      } catch (err) {
        console.log('Altering parking_lots columns to TIME skipped or already done:', err.message);
      }
    } else {
      console.error('Failed to connect to the database.');
    }
  }
}
