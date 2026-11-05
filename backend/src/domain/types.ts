import { z } from 'zod';

export const CATEGORIES = [
  'PRODUCT_DEFECT',
  'FALSE_ADVERTISING',
  'BILLING_OVERCHARGE',
  'DATA_PRIVACY',
  'CONTRACT_BREACH',
  'SERVICE_FAILURE',
  'OTHER',
] as const;
export const CategorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof CategorySchema>;

export const CLAIM_STATUSES = ['READY_FOR_REVIEW', 'NEEDS_INFO', 'DUPLICATE', 'FLAGGED'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const REVIEW_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const ClaimInputSchema = z.object({
  participantName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  company: z.string().trim().max(200).optional(),
  description: z.string().trim().min(20, 'Please describe the problem in at least 20 characters').max(5000),
  documentText: z.string().max(20000).optional(),
});
export type ClaimInput = z.infer<typeof ClaimInputSchema>;

export const ExtractedFactsSchema = z.object({
  company: z.string().max(200).nullable(),
  incidentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  amount: z.number().nonnegative().nullable(),
  currency: z.string().max(8).nullable(),
  productOrService: z.string().max(200).nullable(),
  keyFacts: z.array(z.string().max(300)).max(8),
});
export type ExtractedFacts = z.infer<typeof ExtractedFactsSchema>;

export const ClassificationSchema = z.object({
  category: CategorySchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(400),
});
export type Classification = z.infer<typeof ClassificationSchema>;

export const SummaryNarrativeSchema = z.object({
  headline: z.string().min(5).max(200),
  overview: z.string().min(10).max(1500),
  commonPatterns: z.array(z.string().max(300)).max(6),
  openIssues: z.array(z.string().max(300)).max(6),
});
export type SummaryNarrative = z.infer<typeof SummaryNarrativeSchema>;

export interface CaseStats {
  totalClaims: number;
  readyForReview: number;
  needsInfo: number;
  flagged: number;
  duplicatesExcluded: number;
  totalAmountByCurrency: Record<string, number>;
  earliestIncident: string | null;
  latestIncident: string | null;
}

export interface CaseSummary extends SummaryNarrative {
  stats: CaseStats;
  source: 'llm' | 'fallback';
  generatedAt: string;
  disclaimer: string;
}

export const LEGAL_DISCLAIMER =
  'This summary is an automatically prepared organisation of submitted material. It is NOT a legal assessment. ' +
  'Whether any claim is legally valid is decided only by a qualified legal professional.';

export interface ParticipantRecord {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

export interface ClaimRecord {
  id: string;
  participantId: string;
  caseId: string | null;
  description: string;
  documentText: string | null;
  company: string | null;
  category: Category;
  categoryConfidence: number;
  extracted: ExtractedFacts;
  missingFields: string[];
  flags: string[];
  status: ClaimStatus;
  duplicateOfId: string | null;
  reviewStatus: ReviewStatus;
  reviewNote: string | null;
  joinedAt: Date | null;
  createdAt: Date;
}

export interface CaseRecord {
  id: string;
  companyKey: string;
  company: string;
  category: Category;
  summary: CaseSummary | null;
  summaryAt: Date | null;
  createdAt: Date;
}

export interface AgentRunRecord {
  id: string;
  claimId: string | null;
  trace: TraceStep[];
  outcome: unknown;
  durationMs: number;
  createdAt: Date;
}

export interface TraceStep {
  step: string;
  tool?: string;
  status: 'ok' | 'fallback' | 'skipped' | 'error';
  durationMs: number;
  attempts?: number;
  detail?: Record<string, unknown>;
}
