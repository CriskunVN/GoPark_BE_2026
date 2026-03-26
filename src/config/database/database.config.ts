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

    // Log SQL queries - Tắt log query để terminal gọn gàng hơn
    logging: false,

    // Cấu hình SSL (chỉ bật khi production hoặc có env DB_SSL=true)
    ssl:
      configService.get('NODE_ENV') === 'production' ||
      configService.get('DB_SSL') === 'true'
        ? { rejectUnauthorized: false }
        : false, // Tắt SSL hoàn toàn ở local

    // Đảm bảo extra options cũng tắt ssl
    extra: {
      ssl:
        configService.get('NODE_ENV') === 'production' ||
        configService.get('DB_SSL') === 'true'
          ? { rejectUnauthorized: false }
          : false,
    },
  };
};
