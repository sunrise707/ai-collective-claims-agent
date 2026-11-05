import { Inject, Injectable, Logger } from '@nestjs/common';
import { ExtractedFacts, ExtractedFactsSchema } from '../../domain/types';
import { LLM_CLIENT, LlmClient, LlmFailedError, LlmUnavailableError } from '../../llm/llm.types';
import { fenceUntrusted, SYSTEM_RULES } from '../guardrails';
import { extractFactsHeuristic } from '../heuristics';
import { ToolResult } from './tool.types';

export interface DocumentAnalyzerInput {
  description: string;
  documentText?: string | null;
  company?: string | null;
}

const SYSTEM = `${SYSTEM_RULES}

TASK: extract facts from a participant's complaint and optional attached document.
Return JSON: {
  "company": string|null,            // the company the complaint is against
  "incidentDate": "YYYY-MM-DD"|null, // when the problem happened
  "amount": number|null,             // money lost/charged, a plain number
  "currency": string|null,           // ISO code like USD, EUR
  "productOrService": string|null,
  "keyFacts": string[]               // up to 6 short factual statements copied or paraphrased from the text
}
Use null when a value is not stated. Never guess or invent values.`;

@Injectable()
export class DocumentAnalyzerTool {
  readonly name = 'document_analyzer';
  private readonly logger = new Logger(DocumentAnalyzerTool.name);

  constructor(@Inject(LLM_CLIENT) private readonly llm: LlmClient) {}

  async run(input: DocumentAnalyzerInput, now = new Date()): Promise<ToolResult<ExtractedFacts>> {
    const text = [input.description, input.documentText].filter(Boolean).join('\n');
    let result: ToolResult<ExtractedFacts>;

    try {
      const user = [
        input.company ? `Company named by participant: ${input.company}` : '',
        fenceUntrusted('claim_description', input.description),
        input.documentText ? fenceUntrusted('attached_document', input.documentText) : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      const { data, attempts } = await this.llm.completeJson({
        name: this.name,
        system: SYSTEM,
        user,
        schema: ExtractedFactsSchema,
      });
      result = { data, source: 'llm', attempts };
    } catch (err) {
      if (!(err instanceof LlmUnavailableError)) this.logger.warn(`LLM extraction failed, using fallback: ${(err as Error).message}`);
      result = {
        data: extractFactsHeuristic(text, input.company),
        source: 'fallback',
        attempts: err instanceof LlmFailedError ? err.attempts : 0,
        note: err instanceof Error ? err.message : undefined,
      };
    }

    return { ...result, data: this.sanitize(result.data, input.company, now) };
  }

  private sanitize(facts: ExtractedFacts, formCompany: string | null | undefined, now: Date): ExtractedFacts {
    const incidentDate = facts.incidentDate && this.isPlausibleDate(facts.incidentDate, now) ? facts.incidentDate : null;
    const amount = facts.amount !== null && facts.amount >= 0 && facts.amount < 1e9 ? facts.amount : null;
    return {
      ...facts,
      company: formCompany?.trim() || facts.company?.trim() || null,
      incidentDate,
      amount,
      currency: amount === null ? null : (facts.currency?.toUpperCase() ?? null),
    };
  }

  private isPlausibleDate(iso: string, now: Date): boolean {
    const t = Date.parse(`${iso}T00:00:00Z`);
    return Number.isFinite(t) && t <= now.getTime() && t >= Date.UTC(1990, 0, 1);
  }
}
