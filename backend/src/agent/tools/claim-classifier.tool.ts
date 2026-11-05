import { Inject, Injectable, Logger } from '@nestjs/common';
import { CATEGORIES, Classification, ClassificationSchema, ExtractedFacts } from '../../domain/types';
import { LLM_CLIENT, LlmClient, LlmFailedError, LlmUnavailableError } from '../../llm/llm.types';
import { fenceUntrusted, SYSTEM_RULES } from '../guardrails';
import { classifyHeuristic } from '../heuristics';
import { ToolResult } from './tool.types';

const SYSTEM = `${SYSTEM_RULES}

TASK: assign exactly one category to the complaint.
Allowed categories: ${CATEGORIES.join(', ')}.
- PRODUCT_DEFECT: physical or digital product is defective or unsafe
- FALSE_ADVERTISING: product/service differs from what was promised in marketing
- BILLING_OVERCHARGE: wrong, duplicate, hidden or unauthorised charges
- DATA_PRIVACY: personal data leaked, misused or collected without consent
- CONTRACT_BREACH: company did not honour contract, warranty or terms
- SERVICE_FAILURE: outage, non-delivery, delays, unresponsive support
- OTHER: none of the above clearly fits
Return JSON: {"category": <one allowed value>, "confidence": number 0..1, "rationale": short sentence}.
Classifying a complaint is NOT a judgement on whether it is legally valid.`;

@Injectable()
export class ClaimClassifierTool {
  readonly name = 'claim_classifier';
  private readonly logger = new Logger(ClaimClassifierTool.name);

  constructor(@Inject(LLM_CLIENT) private readonly llm: LlmClient) {}

  async run(input: { description: string; documentText?: string | null; facts: ExtractedFacts }): Promise<ToolResult<Classification>> {
    const text = [input.description, input.documentText].filter(Boolean).join('\n');
    try {
      const user = [
        `Extracted facts (JSON): ${JSON.stringify({ product: input.facts.productOrService, amount: input.facts.amount })}`,
        fenceUntrusted('claim_description', input.description),
        input.documentText ? fenceUntrusted('attached_document', input.documentText) : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      const { data, attempts } = await this.llm.completeJson({
        name: this.name,
        system: SYSTEM,
        user,
        schema: ClassificationSchema,
      });
      return { data, source: 'llm', attempts };
    } catch (err) {
      if (!(err instanceof LlmUnavailableError)) this.logger.warn(`LLM classification failed, using fallback: ${(err as Error).message}`);
      return {
        data: classifyHeuristic(text),
        source: 'fallback',
        attempts: err instanceof LlmFailedError ? err.attempts : 0,
        note: err instanceof Error ? err.message : undefined,
      };
    }
  }
}
