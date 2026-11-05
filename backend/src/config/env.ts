import { z } from 'zod';

const EnvObjectSchema = z.object({
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.string().default('info'),
  STORAGE: z.enum(['postgres', 'memory']).default('postgres'),
  DATABASE_URL: z.string().optional(),
  LLM_PROVIDER: z.enum(['anthropic', 'openai', 'none']).optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
  ANTHROPIC_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_BASE_URL: z.string().url().optional(),
  LLM_TIMEOUT_MS: z.coerce.number().default(20000),
  LLM_MAX_RETRIES: z.coerce.number().default(2),
  DUPLICATE_SIMILARITY_THRESHOLD: z.coerce.number().default(0.6),
});

const EnvSchema = EnvObjectSchema.refine((env) => env.STORAGE !== 'postgres' || !!env.DATABASE_URL, {
  path: ['DATABASE_URL'],
  message: 'DATABASE_URL is required when STORAGE=postgres. Copy .env.example to backend/.env, or start with STORAGE=memory to run without a database',
});

export type Env = z.infer<typeof EnvObjectSchema>;

export const ENV = Symbol('ENV');

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const cleaned = Object.fromEntries(
    Object.entries(source)
      .map(([key, value]) => [key, value?.trim()] as const)
      .filter(([, value]) => value !== undefined && value !== ''),
  );
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  return parsed.data;
}
