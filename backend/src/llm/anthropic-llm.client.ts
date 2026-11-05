import { Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { parseJsonOutput } from './json-output';
import { LlmClient, LlmFailedError, LlmRequest, LlmResult } from './llm.types';

export type AnthropicEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AnthropicClientOptions {
  apiKey?: string;
  model: string;
  effort?: AnthropicEffort;
  timeoutMs: number;
  maxRetries: number;
  backoffMs?: number;
}

const SERVER_FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);
const SERVER_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MAX_TOKENS = 16000;
const RETRYABLE_STATUSES = new Set([408, 409, 429]);

interface ContentBlockLike {
  type: string;
  text?: string;
}

interface MessageLike {
  content: ContentBlockLike[];
  stop_reason: string | null;
  stop_details?: { category?: string | null } | null;
}

export class AnthropicLlmClient implements LlmClient {
  readonly enabled = true;
  readonly label: string;
  private readonly logger = new Logger(AnthropicLlmClient.name);
  private readonly anthropic: Anthropic;

  constructor(private readonly options: AnthropicClientOptions) {
    this.anthropic = new Anthropic({ apiKey: options.apiKey, maxRetries: 0, timeout: options.timeoutMs });
    this.label = `${options.model} @ api.anthropic.com`;
  }

  async completeJson<T>(request: LlmRequest<T>): Promise<LlmResult<T>> {
    const maxAttempts = this.options.maxRetries + 1;
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: request.user }];
    let lastError = 'unknown error';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const message = await this.send(request.system, messages);

        if (message.stop_reason === 'refusal') {
          const category = message.stop_details?.category ?? 'unspecified';
          throw new LlmFailedError(`model declined the request (category: ${category})`, attempt);
        }

        const text = message.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text ?? '')
          .join('');
        const validation = parseJsonOutput(text, request.schema);
        if (validation.ok) return { data: validation.data, attempts: attempt };

        lastError = validation.error;
        this.logger.warn({ tool: request.name, attempt, error: lastError }, 'LLM output rejected, retrying');
        messages.push(
          { role: 'assistant', content: text || '(no output)' },
          {
            role: 'user',
            content: `Your previous answer was invalid: ${lastError}. Reply again with ONLY a JSON object that matches the required schema.`,
          },
        );
      } catch (err) {
        if (err instanceof LlmFailedError) throw err;
        lastError = err instanceof Error ? err.message : String(err);
        this.logger.warn({ tool: request.name, attempt, error: lastError }, 'LLM call failed');
        if (this.isPermanent(err)) throw new LlmFailedError(`LLM request rejected: ${lastError}`, attempt);
        const backoff = (this.options.backoffMs ?? 400) * 2 ** (attempt - 1);
        if (attempt < maxAttempts && backoff > 0) await new Promise((r) => setTimeout(r, backoff));
      }
    }
    throw new LlmFailedError(`LLM failed after ${maxAttempts} attempts: ${lastError}`, maxAttempts);
  }

  private send(system: string, messages: Anthropic.MessageParam[]): Promise<MessageLike> {
    const params = {
      model: this.options.model,
      max_tokens: MAX_TOKENS,
      system,
      messages,
      ...(this.options.effort ? { output_config: { effort: this.options.effort } } : {}),
    };
    if (SERVER_FALLBACK_MODELS.has(this.options.model)) {
      return this.anthropic.beta.messages.create({
        ...params,
        betas: [SERVER_FALLBACK_BETA],
        fallbacks: 'default',
      }) as Promise<MessageLike>;
    }
    return this.anthropic.messages.create(params) as Promise<MessageLike>;
  }

  private isPermanent(err: unknown): boolean {
    return err instanceof Anthropic.APIError && typeof err.status === 'number' && err.status < 500 && !RETRYABLE_STATUSES.has(err.status);
  }
}
