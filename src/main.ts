import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { TransformInterceptor } from './utils/tranform.interceptor';
import { HttpExceptionFilter } from './utils/http-exception.filter';
import morgan from 'morgan';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.enableCors(); // Enable CORS for all origins (development purposes)

  // Increase payload limit to 50MB for Base64 image uploads
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));

  app.use(morgan('dev')); // Log request method, URL, status, response time
  app.useGlobalInterceptors(new TransformInterceptor()); // Áp dụng interceptor để chuẩn hóa response
  app.useGlobalFilters(new HttpExceptionFilter()); // Áp dụng filter để chuẩn hóa lỗi
  app.useGlobalPipes(new ValidationPipe()); // Bật validation pipe toàn cục để tự động validate DTOs
  await app.listen(process.env.PORT ?? 3000);
  console.log('Server is running on port', process.env.PORT);
}
bootstrap();
