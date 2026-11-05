import { z } from 'zod';

export const LLM_CLIENT = Symbol('LLM_CLIENT');

export interface LlmRequest<T> {
  name: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
}

export interface LlmResult<T> {
  data: T;
  attempts: number;
}

export class LlmUnavailableError extends Error {
  constructor(message = 'LLM is not configured (OPENAI_API_KEY is missing)') {
    super(message);
    this.name = 'LlmUnavailableError';
  }
}

export class LlmFailedError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
  ) {
    super(message);
    this.name = 'LlmFailedError';
  }
}

export interface LlmClient {
  readonly enabled: boolean;
  readonly label?: string;
  completeJson<T>(request: LlmRequest<T>): Promise<LlmResult<T>>;
}
