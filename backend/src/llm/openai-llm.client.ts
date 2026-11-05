import { Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { parseJsonOutput } from './json-output';
import { LlmClient, LlmFailedError, LlmRequest, LlmResult, LlmUnavailableError } from './llm.types';

export interface OpenAiClientOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs: number;
  maxRetries: number;
  backoffMs?: number;
}

export class OpenAiLlmClient implements LlmClient {
  readonly enabled = true;
  readonly label: string;
  private readonly logger = new Logger(OpenAiLlmClient.name);
  private readonly openai: OpenAI;

  constructor(private readonly options: OpenAiClientOptions) {
    this.label = `${options.model} @ ${options.baseUrl ?? 'api.openai.com'}`;
    this.openai = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseUrl, maxRetries: 0, timeout: options.timeoutMs });
  }

  async completeJson<T>(request: LlmRequest<T>): Promise<LlmResult<T>> {
    const maxAttempts = this.options.maxRetries + 1;
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ];
    let lastError = 'unknown error';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const completion = await this.openai.chat.completions.create({
          model: this.options.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages,
        });
        const content = completion.choices[0]?.message?.content ?? '';
        const validation = parseJsonOutput(content, request.schema);
        if (validation.ok) return { data: validation.data, attempts: attempt };

        lastError = validation.error;
        this.logger.warn({ tool: request.name, attempt, error: lastError }, 'LLM output rejected, retrying');
        messages.push(
          { role: 'assistant', content },
          {
            role: 'user',
            content: `Your previous answer was invalid: ${lastError}. Reply again with ONLY a JSON object that matches the required schema.`,
          },
        );
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        this.logger.warn({ tool: request.name, attempt, error: lastError }, 'LLM call failed');
        const backoff = (this.options.backoffMs ?? 400) * 2 ** (attempt - 1);
        if (attempt < maxAttempts && backoff > 0) await new Promise((r) => setTimeout(r, backoff));
      }
    }
    throw new LlmFailedError(`LLM failed after ${maxAttempts} attempts: ${lastError}`, maxAttempts);
  }
}

export class DisabledLlmClient implements LlmClient {
  readonly enabled = false;
  readonly label = 'offline heuristics';
  async completeJson<T>(): Promise<LlmResult<T>> {
    throw new LlmUnavailableError();
  }
}
