import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getDatabaseConfig } from './config/database/database.config';

import { UsersModule } from './modules/users/users.module';
import { UsersService } from './modules/users/users.service';
import { WalletModule } from './modules/wallet/wallet.module';
import { ParkingModule } from './modules/parking/parking.module';
import { BookingModule } from './modules/booking/booking.module';
import { PaymentModule } from './modules/payment/payment.module';
import { AuthModule } from './modules/auth/auth.module';
import { DataSource } from 'typeorm';
import { AdminModule } from './modules/admin/admin.module';
import { RequestModule } from './modules/request/request.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: getDatabaseConfig,
    }),
    AuthModule,
    UsersModule,
    WalletModule,
    ParkingModule,
    BookingModule,
    PaymentModule,
    AdminModule,
    RequestModule,
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
