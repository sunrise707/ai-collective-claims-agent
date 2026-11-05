import { loadEnv } from '../../src/config/env';
import { AnthropicLlmClient } from '../../src/llm/anthropic-llm.client';
import { createLlmClient, resolveProvider } from '../../src/llm/create-llm-client';
import { DisabledLlmClient, OpenAiLlmClient } from '../../src/llm/openai-llm.client';

const env = (vars: Record<string, string>) => loadEnv({ STORAGE: 'memory', ...vars });

describe('resolveProvider / createLlmClient', () => {
  it('is offline without any key', () => {
    expect(resolveProvider(env({}))).toBe('none');
    expect(createLlmClient(env({}))).toBeInstanceOf(DisabledLlmClient);
  });

  it('uses Claude when only ANTHROPIC_API_KEY is set, with Opus 5.5 as the default model', () => {
    const client = createLlmClient(env({ ANTHROPIC_API_KEY: 'k' }));
    expect(client).toBeInstanceOf(AnthropicLlmClient);
    expect(client.label).toBe('claude-opus-5-5 @ api.anthropic.com');
  });

  it('uses OpenAI when only OPENAI_API_KEY is set', () => {
    const client = createLlmClient(env({ OPENAI_API_KEY: 'k', OPENAI_BASE_URL: 'http://localhost:11434/v1' }));
    expect(client).toBeInstanceOf(OpenAiLlmClient);
    expect(client.label).toBe('gpt-4o-mini @ http://localhost:11434/v1');
  });

  it('prefers Claude when both keys are set, unless LLM_PROVIDER says otherwise', () => {
    expect(resolveProvider(env({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o' }))).toBe('anthropic');
    expect(resolveProvider(env({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', LLM_PROVIDER: 'openai' }))).toBe('openai');
    expect(resolveProvider(env({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', LLM_PROVIDER: 'none' }))).toBe('none');
  });

  it('allows LLM_PROVIDER=anthropic without a key (the SDK resolves its own credentials)', () => {
    expect(createLlmClient(env({ LLM_PROVIDER: 'anthropic' }))).toBeInstanceOf(AnthropicLlmClient);
  });

  it('is offline when LLM_PROVIDER=openai has no key', () => {
    expect(resolveProvider(env({ LLM_PROVIDER: 'openai' }))).toBe('none');
  });

  it('treats empty variables (as passed by docker compose) as unset', () => {
    const e = env({ ANTHROPIC_API_KEY: '', ANTHROPIC_EFFORT: '', ANTHROPIC_MODEL: '', LLM_PROVIDER: '', OPENAI_BASE_URL: '' });
    expect(e.ANTHROPIC_MODEL).toBe('claude-opus-5-5');
    expect(resolveProvider(e)).toBe('none');
  });

  it('rejects an invalid effort value', () => {
    expect(() => env({ ANTHROPIC_EFFORT: 'extreme' })).toThrow();
  });
});
