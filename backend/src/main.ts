import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createLogger } from './common/logger';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const logger = createLogger('Bootstrap');
  const app = await NestFactory.create(AppModule, { logger });
  const configService = app.get(ConfigService);
  const frontendUrl = configService.get<string>('FRONTEND_URL');
  const backendUrl = configService.get<string>('BACKEND_URL');
  const port = configService.get<number>('PORT');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  app.enableShutdownHooks();

  app.enableCors({
    origin: frontendUrl,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  const config = new DocumentBuilder()
    .setTitle('NexTick API')
    .setDescription(
      'API documentation for NexTick - Real-time cryptocurrency data and trading platform',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(port);
  logger.info(`Application is running on: ${backendUrl}`);
  logger.info(`Swagger UI is available at: ${backendUrl}/api/docs`);
}
void bootstrap();
