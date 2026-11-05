import { Category, ClaimRecord } from '../../domain/types';
import { normalizeCompany } from '../guardrails';

const STOP_WORDS = new Set(
  'the and for with that this was were have has had not but from they them their been when then than into over after before about would could should which while there here your you our out one two get got let its it\'s i\'m just also very much more some any all can did does don\'t didn\'t'.split(
    ' ',
  ),
);

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

export function similarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const w of ta) if (tb.has(w)) common++;
  return common / (ta.size + tb.size - common);
}

export interface DuplicateCheckInput {
  participantId: string;
  company: string | null;
  category: Category;
  incidentDate: string | null;
  description: string;
  existing: ClaimRecord[];
}

export interface SimilarClaim {
  claimId: string;
  similarity: number;
  sameParticipant: boolean;
}

export interface DuplicateCheckResult {
  duplicateOfId: string | null;
  reason: string | null;
  similar: SimilarClaim[];
}

const SIMILAR_MIN = 0.3;

export class DuplicateDetectorTool {
  readonly name = 'duplicate_detector';

  constructor(private readonly threshold = 0.6) {}

  run(input: DuplicateCheckInput): DuplicateCheckResult {
    const key = input.company ? normalizeCompany(input.company) : null;
    const candidates = input.existing.filter(
      (c) => c.status !== 'DUPLICATE' && key !== null && c.company !== null && normalizeCompany(c.company) === key,
    );

    const scored = candidates
      .map((c) => ({ claim: c, sim: similarity(input.description, c.description) }))
      .sort((a, b) => b.sim - a.sim);

    let duplicateOfId: string | null = null;
    let reason: string | null = null;
    for (const { claim, sim } of scored) {
      if (claim.participantId !== input.participantId) continue;
      const sameIncident = claim.category === input.category && !!input.incidentDate && claim.extracted.incidentDate === input.incidentDate;
      if (sim >= this.threshold) {
        duplicateOfId = claim.id;
        reason = `Same participant and company; text similarity ${sim.toFixed(2)} >= ${this.threshold}`;
        break;
      }
      if (sameIncident) {
        duplicateOfId = claim.id;
        reason = `Same participant, company, category and incident date (${input.incidentDate})`;
        break;
      }
    }

    const similar = scored
      .filter(({ claim, sim }) => claim.id !== duplicateOfId && sim >= SIMILAR_MIN)
      .slice(0, 5)
      .map(({ claim, sim }) => ({
        claimId: claim.id,
        similarity: Math.round(sim * 100) / 100,
        sameParticipant: claim.participantId === input.participantId,
      }));

    return { duplicateOfId, reason, similar };
  }
}
