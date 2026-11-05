import { LlmClient, LlmFailedError, LlmRequest, LlmResult } from '../../src/llm/llm.types';

type Handler = (request: LlmRequest<unknown>) => unknown | Promise<unknown>;

export class FakeLlm implements LlmClient {
  readonly enabled = true;
  readonly calls: string[] = [];

  constructor(private readonly handlers: Record<string, Handler>) {}

  async completeJson<T>(request: LlmRequest<T>): Promise<LlmResult<T>> {
    this.calls.push(request.name);
    const handler = this.handlers[request.name];
    if (!handler) throw new LlmFailedError(`no handler for ${request.name}`, 1);
    const raw = await handler(request as LlmRequest<unknown>);
    const parsed = request.schema.safeParse(raw);
    if (!parsed.success) throw new LlmFailedError(`schema violation: ${parsed.error.message}`, 1);
    return { data: parsed.data, attempts: 1 };
  }
}
