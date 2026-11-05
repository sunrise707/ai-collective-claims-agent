import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { AnthropicClientOptions, AnthropicLlmClient } from '../../src/llm/anthropic-llm.client';
import { LlmFailedError } from '../../src/llm/llm.types';

const schema = z.object({ category: z.enum(['A', 'B']) });
const request = { name: 'test', system: 'sys', user: 'usr', schema };

const reply = (text: string, extra: Record<string, unknown> = {}) => ({
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }],
  stop_reason: 'end_turn',
  ...extra,
});

function clientWith(create: jest.Mock, options: Partial<AnthropicClientOptions> = {}, betaCreate: jest.Mock = jest.fn()) {
  const client = new AnthropicLlmClient({
    apiKey: 'test',
    model: 'claude-haiku-5-5',
    timeoutMs: 1000,
    maxRetries: 2,
    backoffMs: 0,
    ...options,
  });
  (client as unknown as { anthropic: unknown }).anthropic = { messages: { create }, beta: { messages: { create: betaCreate } } };
  return client;
}

describe('AnthropicLlmClient', () => {
  it('returns validated data and sends no sampling parameters', async () => {
    const create = jest.fn().mockResolvedValue(reply('{"category":"A"}'));
    await expect(clientWith(create).completeJson(request)).resolves.toEqual({ data: { category: 'A' }, attempts: 1 });
    const params = create.mock.calls[0][0];
    expect(params).toMatchObject({ model: 'claude-haiku-5-5', system: 'sys', messages: [{ role: 'user', content: 'usr' }] });
    expect(params).not.toHaveProperty('temperature');
    expect(params).not.toHaveProperty('betas');
    expect(params).not.toHaveProperty('output_config');
  });

  it('passes the configured effort', async () => {
    const create = jest.fn().mockResolvedValue(reply('{"category":"A"}'));
    await clientWith(create, { effort: 'low' }).completeJson(request);
    expect(create.mock.calls[0][0].output_config).toEqual({ effort: 'low' });
  });

  it('opts into server-side fallbacks for models that support them', async () => {
    const create = jest.fn();
    const betaCreate = jest.fn().mockResolvedValue(reply('{"category":"B"}'));
    const result = await clientWith(create, { model: 'claude-opus-5-5' }, betaCreate).completeJson(request);
    expect(result.data).toEqual({ category: 'B' });
    expect(create).not.toHaveBeenCalled();
    expect(betaCreate.mock.calls[0][0]).toMatchObject({
      model: 'claude-opus-5-5',
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
  });

  it('accepts JSON wrapped in a markdown fence', async () => {
    const create = jest.fn().mockResolvedValue(reply('```json\n{"category":"A"}\n```'));
    await expect(clientWith(create).completeJson(request)).resolves.toMatchObject({ data: { category: 'A' } });
  });

  it('retries with the validation error fed back when the output is invalid', async () => {
    const create = jest
      .fn()
      .mockResolvedValueOnce(reply('not json'))
      .mockResolvedValueOnce(reply('{"category":"Z"}'))
      .mockResolvedValueOnce(reply('{"category":"B"}'));
    await expect(clientWith(create).completeJson(request)).resolves.toEqual({ data: { category: 'B' }, attempts: 3 });
    const lastMessages = create.mock.calls[2][0].messages;
    expect(lastMessages[lastMessages.length - 1]).toMatchObject({ role: 'user', content: expect.stringMatching(/invalid/) });
  });

  it('retries after transient errors', async () => {
    const create = jest.fn().mockRejectedValueOnce(new Error('connection reset')).mockResolvedValueOnce(reply('{"category":"A"}'));
    await expect(clientWith(create).completeJson(request)).resolves.toMatchObject({ attempts: 2 });
  });

  it('does not retry a permanent client error', async () => {
    const error = new Anthropic.BadRequestError(400, undefined, 'bad request', new Headers());
    const create = jest.fn().mockRejectedValue(error);
    await expect(clientWith(create).completeJson(request)).rejects.toBeInstanceOf(LlmFailedError);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the model declines the request', async () => {
    const create = jest.fn().mockResolvedValue({ content: [], stop_reason: 'refusal', stop_details: { category: 'general_harms' } });
    await expect(clientWith(create).completeJson(request)).rejects.toThrow(/declined.*general_harms/);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('gives up with LlmFailedError after maxRetries + 1 attempts', async () => {
    const create = jest.fn().mockResolvedValue(reply('{"category":"nope"}'));
    await expect(clientWith(create, { maxRetries: 1 }).completeJson(request)).rejects.toBeInstanceOf(LlmFailedError);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
