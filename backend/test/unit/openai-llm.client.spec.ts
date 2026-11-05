import { z } from 'zod';
import { OpenAiLlmClient } from '../../src/llm/openai-llm.client';
import { LlmFailedError } from '../../src/llm/llm.types';

const schema = z.object({ category: z.enum(['A', 'B']) });
const request = { name: 'test', system: 'sys', user: 'usr', schema };

function clientWith(create: jest.Mock, maxRetries = 2) {
  const client = new OpenAiLlmClient({ apiKey: 'test', model: 'm', timeoutMs: 1000, maxRetries, backoffMs: 0 });
  (client as unknown as { openai: unknown }).openai = { chat: { completions: { create } } };
  return client;
}
const reply = (content: string) => ({ choices: [{ message: { content } }] });

describe('OpenAiLlmClient', () => {
  it('returns validated data on the first attempt', async () => {
    const create = jest.fn().mockResolvedValue(reply('{"category":"A"}'));
    await expect(clientWith(create).completeJson(request)).resolves.toEqual({ data: { category: 'A' }, attempts: 1 });
  });

  it('retries with the validation error fed back when the output is invalid', async () => {
    const create = jest.fn().mockResolvedValueOnce(reply('not json')).mockResolvedValueOnce(reply('{"category":"Z"}')).mockResolvedValueOnce(reply('{"category":"B"}'));
    const result = await clientWith(create).completeJson(request);
    expect(result).toEqual({ data: { category: 'B' }, attempts: 3 });
    const lastMessages = create.mock.calls[2][0].messages;
    expect(lastMessages[lastMessages.length - 1].content).toMatch(/invalid/);
  });

  it('retries after transient API errors', async () => {
    const create = jest.fn().mockRejectedValueOnce(new Error('429')).mockResolvedValueOnce(reply('{"category":"A"}'));
    await expect(clientWith(create).completeJson(request)).resolves.toMatchObject({ attempts: 2 });
  });

  it('gives up with LlmFailedError after maxRetries + 1 attempts', async () => {
    const create = jest.fn().mockResolvedValue(reply('{"category":"nope"}'));
    await expect(clientWith(create, 1).completeJson(request)).rejects.toBeInstanceOf(LlmFailedError);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
