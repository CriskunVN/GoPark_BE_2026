import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.enableCors(); // Enable CORS for all origins (development purposes)
  app.useGlobalPipes(new ValidationPipe()); // Enable validation globally
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
