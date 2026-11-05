import { loadEnv } from '../../src/config/env';

describe('loadEnv', () => {
  it('fails fast with a readable message when postgres storage has no DATABASE_URL', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL is required when STORAGE=postgres/);
    expect(() => loadEnv({ STORAGE: 'postgres', DATABASE_URL: '  ' })).toThrow(/DATABASE_URL/);
  });

  it('accepts postgres storage with a DATABASE_URL', () => {
    expect(loadEnv({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db' }).STORAGE).toBe('postgres');
  });

  it('does not need a database for memory storage', () => {
    expect(loadEnv({ STORAGE: 'memory' }).DATABASE_URL).toBeUndefined();
  });

  it('reports every invalid variable at once', () => {
    expect(() => loadEnv({ STORAGE: 'memory', PORT: 'abc', ANTHROPIC_EFFORT: 'extreme' })).toThrow(/PORT[\s\S]*ANTHROPIC_EFFORT/);
  });
});
