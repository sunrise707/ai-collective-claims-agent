import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  Category,
  ClaimInput,
  ClaimStatus,
  ExtractedFacts,
  TraceStep,
} from '../domain/types';
import { REPOSITORY, Repository } from '../storage/repository';
import { checkCompleteness } from './completeness';
import { detectPromptInjection } from './guardrails';
import { CaseRegistryTool } from './tools/case-registry.tool';
import { CaseSummaryTool } from './tools/case-summary.tool';
import { ClaimClassifierTool } from './tools/claim-classifier.tool';
import { DocumentAnalyzerTool } from './tools/document-analyzer.tool';
import { DuplicateDetectorTool, SimilarClaim } from './tools/duplicate-detector.tool';

export const DUPLICATE_DETECTOR = Symbol('DUPLICATE_DETECTOR');

export interface AgentResult {
  claimId: string;
  status: ClaimStatus;
  category: Category;
  categoryConfidence: number;
  extracted: ExtractedFacts;
  missingFields: string[];
  followUpQuestions: string[];
  flags: string[];
  duplicateOfId: string | null;
  similarClaims: SimilarClaim[];
  case: { id: string; company: string; category: Category; claimsInCase: number } | null;
  requiresHumanReview: true;
  decision: string;
  trace: TraceStep[];
  durationMs: number;
}

const LOW_CONFIDENCE = 0.5;

@Injectable()
export class ClaimsAgent {
  private readonly logger = new Logger(ClaimsAgent.name);

  constructor(
    private readonly analyzer: DocumentAnalyzerTool,
    private readonly classifier: ClaimClassifierTool,
    @Inject(DUPLICATE_DETECTOR) private readonly detector: DuplicateDetectorTool,
    private readonly registry: CaseRegistryTool,
    private readonly summarizer: CaseSummaryTool,
    @Inject(REPOSITORY) private readonly repo: Repository,
  ) {}

  async process(input: ClaimInput): Promise<AgentResult> {
    const started = Date.now();
    const trace: TraceStep[] = [];
    try {
      const result = await this.execute(input, trace, started);
      const { trace: _t, ...outcome } = result;
      await this.repo.saveRun({ claimId: result.claimId, trace, outcome, durationMs: result.durationMs });
      this.logger.log({ event: 'agent_decision', claimId: result.claimId, status: result.status, category: result.category, flags: result.flags, durationMs: result.durationMs }, result.decision);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ event: 'agent_failed', error: message, trace }, 'Claim processing failed');
      await this.repo
        .saveRun({ claimId: null, trace, outcome: { error: message }, durationMs: Date.now() - started })
        .catch(() => undefined);
      throw err;
    }
  }

  private async execute(input: ClaimInput, trace: TraceStep[], started: number): Promise<AgentResult> {
    const injectionHits = await this.step(trace, 'guardrails', undefined, async () => {
      const hits = detectPromptInjection(input.description, input.documentText, input.company);
      return { value: hits, detail: { injectionPatterns: hits } };
    });

    const analysis = await this.step(trace, 'analyze_document', this.analyzer.name, async () => {
      const res = await this.analyzer.run({ description: input.description, documentText: input.documentText, company: input.company });
      return { value: res.data, source: res.source, attempts: res.attempts, detail: { note: res.note, facts: res.data } };
    });

    const classification = await this.step(trace, 'classify_claim', this.classifier.name, async () => {
      const res = await this.classifier.run({ description: input.description, documentText: input.documentText, facts: analysis });
      return { value: res.data, source: res.source, attempts: res.attempts, detail: { note: res.note, ...res.data } };
    });

    const completeness = await this.step(trace, 'check_completeness', undefined, async () => {
      const res = checkCompleteness(analysis, !!input.documentText);
      return { value: res, detail: { missingFields: res.missingFields } };
    });

    const participant = await this.step(trace, 'register_participant', this.registry.name, async () => {
      const p = await this.registry.registerParticipant({ name: input.participantName, email: input.email });
      return { value: p, detail: { participantId: p.id } };
    });

    const duplicates = await this.step(trace, 'detect_duplicates', this.detector.name, async () => {
      const existing = await this.registry.listClaims();
      const res = this.detector.run({
        participantId: participant.id,
        company: analysis.company,
        category: classification.category,
        incidentDate: analysis.incidentDate,
        description: input.description,
        existing,
      });
      return { value: res, detail: { duplicateOfId: res.duplicateOfId, reason: res.reason, similar: res.similar } };
    });

    const flags: string[] = [];
    if (injectionHits.length > 0) flags.push('PROMPT_INJECTION_SUSPECTED');
    if (classification.confidence < LOW_CONFIDENCE) flags.push('LOW_CLASSIFICATION_CONFIDENCE');

    const status: ClaimStatus =
      injectionHits.length > 0
        ? 'FLAGGED'
        : duplicates.duplicateOfId
          ? 'DUPLICATE'
          : completeness.missingFields.length > 0
            ? 'NEEDS_INFO'
            : 'READY_FOR_REVIEW';

    const registered = await this.step(trace, 'register_claim', this.registry.name, async () => {
      const caseRecord =
        analysis.company && status !== 'DUPLICATE' ? await this.registry.assignCase(analysis.company, classification.category) : null;
      const claim = await this.registry.registerClaim({
        participantId: participant.id,
        caseId: caseRecord?.id ?? null,
        description: input.description,
        documentText: input.documentText ?? null,
        company: analysis.company,
        category: classification.category,
        categoryConfidence: classification.confidence,
        extracted: analysis,
        missingFields: completeness.missingFields,
        flags,
        status,
        duplicateOfId: duplicates.duplicateOfId,
      });
      return { value: { claim, caseRecord }, detail: { claimId: claim.id, status, caseId: caseRecord?.id ?? null } };
    });

    let claimsInCase = 0;
    if (registered.caseRecord) {
      const caseRecord = registered.caseRecord;
      try {
        await this.step(trace, 'update_case_summary', 'case_summary_generator', async () => {
          const claims = await this.registry.caseClaims(caseRecord.id);
          claimsInCase = claims.filter((c) => c.status !== 'DUPLICATE' && c.reviewStatus !== 'REJECTED').length;
          const res = await this.summarizer.run(caseRecord, claims);
          await this.registry.saveSummary(caseRecord.id, res.data);
          return {
            value: res.data,
            source: res.source,
            attempts: res.attempts,
            detail: { note: res.note, blockedLegalPhrases: res.blockedLegalPhrases, stats: res.data.stats },
          };
        });
      } catch {
      }
    } else {
      trace.push({ step: 'update_case_summary', status: 'skipped', durationMs: 0, detail: { reason: 'claim is not part of a case' } });
    }

    const durationMs = Date.now() - started;
    return {
      claimId: registered.claim.id,
      status,
      category: classification.category,
      categoryConfidence: classification.confidence,
      extracted: analysis,
      missingFields: completeness.missingFields,
      followUpQuestions: completeness.followUpQuestions,
      flags,
      duplicateOfId: duplicates.duplicateOfId,
      similarClaims: duplicates.similar,
      case: registered.caseRecord
        ? { id: registered.caseRecord.id, company: registered.caseRecord.company, category: registered.caseRecord.category, claimsInCase }
        : null,
      requiresHumanReview: true,
      decision: this.describe({
        name: input.participantName,
        status,
        claimId: registered.claim.id,
        category: classification.category,
        confidence: classification.confidence,
        analysis,
        missing: completeness.missingFields,
        duplicateOfId: duplicates.duplicateOfId,
        duplicateReason: duplicates.reason,
        injectionHits,
        caseLabel: registered.caseRecord ? `${registered.caseRecord.company} / ${registered.caseRecord.category}` : null,
        claimsInCase,
        similarCount: duplicates.similar.length,
      }),
      trace,
      durationMs,
    };
  }

  private async step<T>(
    trace: TraceStep[],
    step: string,
    tool: string | undefined,
    fn: () => Promise<{ value: T; source?: 'llm' | 'fallback'; attempts?: number; detail?: Record<string, unknown> }>,
  ): Promise<T> {
    const t0 = Date.now();
    try {
      const r = await fn();
      const entry: TraceStep = {
        step,
        tool,
        status: r.source === 'fallback' ? 'fallback' : 'ok',
        durationMs: Date.now() - t0,
        attempts: r.attempts,
        detail: r.detail,
      };
      trace.push(entry);
      this.logger.log({ event: 'agent_step', step, tool, status: entry.status, durationMs: entry.durationMs, attempts: r.attempts });
      return r.value;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      trace.push({ step, tool, status: 'error', durationMs: Date.now() - t0, detail: { error: message } });
      this.logger.error({ event: 'agent_step', step, tool, status: 'error', error: message });
      throw err;
    }
  }

  private describe(d: {
    name: string;
    status: ClaimStatus;
    claimId: string;
    category: Category;
    confidence: number;
    analysis: ExtractedFacts;
    missing: string[];
    duplicateOfId: string | null;
    duplicateReason: string | null;
    injectionHits: string[];
    caseLabel: string | null;
    claimsInCase: number;
    similarCount: number;
  }): string {
    const lines = [
      `Claim ${d.claimId.slice(0, 8)} from ${d.name} registered with status ${d.status}.`,
      `Category: ${d.category} (confidence ${d.confidence}). Company: ${d.analysis.company ?? 'unknown'}. ` +
        `Incident date: ${d.analysis.incidentDate ?? 'unknown'}. ` +
        `Amount: ${d.analysis.amount !== null ? `${d.analysis.amount} ${d.analysis.currency ?? ''}`.trim() : 'not stated'}.`,
    ];
    if (d.missing.length) lines.push(`Missing information: ${d.missing.join(', ')} - follow-up questions were prepared.`);
    if (d.duplicateOfId) lines.push(`Duplicate of claim ${d.duplicateOfId.slice(0, 8)}: ${d.duplicateReason}. It is not counted in the case.`);
    if (d.injectionHits.length) lines.push(`Suspicious instruction-like content detected (${d.injectionHits.join(', ')}); the text was treated as data only and the claim needs a manual check.`);
    if (d.caseLabel) lines.push(`Grouped into case "${d.caseLabel}" (${d.claimsInCase} active claim(s)). ${d.similarCount} similar claim(s) found.`);
    lines.push('No legal assessment was made: a legal professional must review this claim.');
    return lines.join(' ');
  }
}
