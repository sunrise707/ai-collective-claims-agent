import { Global, Module } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { InMemoryRepository } from './in-memory.repository';
import { PrismaRepository } from './prisma.repository';
import { REPOSITORY } from './repository';

@Global()
@Module({
  providers: [
    {
      provide: REPOSITORY,
      inject: [ENV],
      useFactory: (env: Env) => (env.STORAGE === 'memory' ? new InMemoryRepository() : new PrismaRepository()),
    },
  ],
  exports: [REPOSITORY],
})
export class StorageModule {}
