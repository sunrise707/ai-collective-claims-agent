import { Env } from '../config/env';
import { AnthropicLlmClient } from './anthropic-llm.client';
import { LlmClient } from './llm.types';
import { DisabledLlmClient, OpenAiLlmClient } from './openai-llm.client';

export type LlmProvider = 'anthropic' | 'openai' | 'none';

export function resolveProvider(env: Env): LlmProvider {
  if (env.LLM_PROVIDER === 'none') return 'none';
  if (env.LLM_PROVIDER === 'anthropic') return 'anthropic';
  if (env.LLM_PROVIDER === 'openai') return env.OPENAI_API_KEY ? 'openai' : 'none';
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  if (env.OPENAI_API_KEY) return 'openai';
  return 'none';
}

export function createLlmClient(env: Env): LlmClient {
  switch (resolveProvider(env)) {
    case 'anthropic':
      return new AnthropicLlmClient({
        apiKey: env.ANTHROPIC_API_KEY,
        model: env.ANTHROPIC_MODEL,
        effort: env.ANTHROPIC_EFFORT,
        timeoutMs: env.LLM_TIMEOUT_MS,
        maxRetries: env.LLM_MAX_RETRIES,
      });
    case 'openai':
      return new OpenAiLlmClient({
        apiKey: env.OPENAI_API_KEY!,
        model: env.OPENAI_MODEL,
        baseUrl: env.OPENAI_BASE_URL,
        timeoutMs: env.LLM_TIMEOUT_MS,
        maxRetries: env.LLM_MAX_RETRIES,
      });
    default:
      return new DisabledLlmClient();
  }
}
