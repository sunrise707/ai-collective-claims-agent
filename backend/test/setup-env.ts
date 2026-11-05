process.env.STORAGE = 'memory';
process.env.OPENAI_API_KEY = '';
process.env.LOG_LEVEL = 'silent';
import { Logger } from '@nestjs/common';

Logger.overrideLogger(false);
