import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { TransformInterceptor } from './utils/tranform.interceptor';
import { HttpExceptionFilter } from './utils/http-exception.filter';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.enableCors(); // Enable CORS for all origins (development purposes)
  app.useGlobalInterceptors(new TransformInterceptor()); // Áp dụng interceptor để chuẩn hóa response
  app.useGlobalFilters(new HttpExceptionFilter()); // Áp dụng filter để chuẩn hóa lỗi
  app.useGlobalPipes(new ValidationPipe()); // Bật validation pipe toàn cục để tự động validate DTOs
  await app.listen(process.env.PORT ?? 3000);
  console.log('Server is running on port', process.env.PORT);
}
bootstrap();
