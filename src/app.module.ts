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
import { BullModule } from '@nestjs/bull';

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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {
  constructor(private dataSource: DataSource) {}
  onModuleInit() {
    if (this.dataSource.isInitialized) {
      console.log('Database connection successfully.');
    } else {
      console.error('Failed to connect to the database.');
    }
  }
}
