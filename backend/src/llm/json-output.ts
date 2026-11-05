import { z } from 'zod';

export type JsonOutputResult<T> = { ok: true; data: T } | { ok: false; error: string };

function extractJson(content: string): { value: unknown } | null {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return { value: JSON.parse(trimmed) };
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return { value: JSON.parse(trimmed.slice(start, end + 1)) };
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function parseJsonOutput<T>(content: string, schema: z.ZodType<T>): JsonOutputResult<T> {
  const json = extractJson(content);
  if (!json) return { ok: false, error: 'not valid JSON' };
  const parsed = schema.safeParse(json.value);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
  return { ok: false, error: issues };
}
