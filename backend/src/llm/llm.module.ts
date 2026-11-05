import { Global, Module } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { createLlmClient } from './create-llm-client';
import { LLM_CLIENT } from './llm.types';

@Global()
@Module({
  providers: [
    {
      provide: LLM_CLIENT,
      inject: [ENV],
      useFactory: (env: Env) => createLlmClient(env),
    },
  ],
  exports: [LLM_CLIENT],
})
export class LlmModule {}
