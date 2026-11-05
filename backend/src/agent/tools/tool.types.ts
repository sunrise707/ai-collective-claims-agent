export interface ToolResult<T> {
  data: T;
  source: 'llm' | 'fallback';
  attempts: number;
  note?: string;
}
