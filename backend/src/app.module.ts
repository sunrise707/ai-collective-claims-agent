import { Global, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AgentModule } from './agent/agent.module';
import { ClaimsController } from './claims/claims.controller';
import { SimilarReportsService } from './claims/similar-reports.service';
import { ENV, Env, loadEnv } from './config/env';
import { LlmModule } from './llm/llm.module';
import { StorageModule } from './storage/storage.module';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
class ConfigModule {}

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          transport: ['production', 'test'].includes(process.env.NODE_ENV ?? '') ? undefined : { target: 'pino-pretty', options: { singleLine: true } },
        },
      }),
    }),
    StorageModule,
    LlmModule,
    AgentModule,
  ],
  controllers: [ClaimsController],
  providers: [SimilarReportsService],
})
export class AppModule {}
