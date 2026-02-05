import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

export const getDatabaseConfig = (
  configService: ConfigService,
): TypeOrmModuleOptions => {
  return {
    type: 'postgres',
    url: configService.get('DATABASE_URL'),

    // Tự động load entities (đỡ phải khai báo thủ công)
    autoLoadEntities: true,

    // Sync database schema (tắt trong production)
    synchronize: configService.get('NODE_ENV') !== 'production',

    // Log SQL queries
    logging: configService.get('NODE_ENV') !== 'production',

    // Cấu hình SSL cho Supabase (Bắt buộc)
    ssl: {
      rejectUnauthorized: false,
    },
  };
};
