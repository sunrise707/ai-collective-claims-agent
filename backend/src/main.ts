import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ENV, Env } from './config/env';
import { LLM_CLIENT, LlmClient } from './llm/llm.types';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');
  app.enableCors();
  const env = app.get<Env>(ENV);
  await app.listen(env.PORT);
  app.get(Logger).log(
    `Claims agent listening on :${env.PORT} (storage=${env.STORAGE}, llm=${app.get<LlmClient>(LLM_CLIENT).label})`,
  );
}

bootstrap();
