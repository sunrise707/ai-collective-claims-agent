export interface ClaimInput {
  participantName: string;
  email: string;
  company?: string;
  description: string;
  documentText?: string;
}

export interface TraceStep {
  step: string;
  tool?: string;
  status: 'ok' | 'fallback' | 'skipped' | 'error';
  durationMs: number;
  attempts?: number;
}

export interface AgentResult {
  claimId: string;
  status: string;
  category: string;
  categoryConfidence: number;
  extracted: { company: string | null; incidentDate: string | null; amount: number | null; currency: string | null; productOrService: string | null; keyFacts: string[] };
  missingFields: string[];
  followUpQuestions: string[];
  flags: string[];
  duplicateOfId: string | null;
  case: { id: string; company: string; category: string; claimsInCase: number } | null;
  decision: string;
  trace: TraceStep[];
  durationMs: number;
}

export interface CaseSummary {
  headline: string;
  overview: string;
  commonPatterns: string[];
  openIssues: string[];
  disclaimer: string;
  source: 'llm' | 'fallback';
  stats: {
    totalClaims: number;
    readyForReview: number;
    needsInfo: number;
    flagged: number;
    duplicatesExcluded: number;
    totalAmountByCurrency: Record<string, number>;
    earliestIncident: string | null;
    latestIncident: string | null;
  };
}

export interface SimilarReports {
  claimId: string;
  eligible: boolean;
  reason: string | null;
  case: { company: string; category: string } | null;
  otherParticipants: number;
  otherParticipantsJoined: number;
  period: { from: string | null; to: string | null };
  joined: boolean;
  joinedAt: string | null;
}

export interface CaseListItem {
  id: string;
  company: string;
  category: string;
  claimCount: number;
}

export interface CaseClaim {
  id: string;
  status: string;
  reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewNote: string | null;
  joinedAt: string | null;
  description: string;
  flags: string[];
  extracted: AgentResult['extracted'];
  participant: { name: string; email: string } | null;
}

export interface CaseDetail {
  case: { id: string; company: string; category: string; summary: CaseSummary | null };
  claims: CaseClaim[];
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: { 'content-type': 'application/json' }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const issues = Array.isArray(body.issues) ? body.issues.map((i: { field: string; message: string }) => `${i.field}: ${i.message}`).join('; ') : '';
    throw new Error(issues || body.message || `HTTP ${res.status}`);
  }
  return body as T;
}

export const api = {
  submitClaim: (input: ClaimInput) => call<AgentResult>('/claims', { method: 'POST', body: JSON.stringify(input) }),
  listCases: () => call<CaseListItem[]>('/cases'),
  getCase: (id: string) => call<CaseDetail>(`/cases/${id}`),
  regenerateSummary: (id: string) => call<CaseSummary>(`/cases/${id}/summary`, { method: 'POST' }),
  similarReports: (claimId: string) => call<SimilarReports>(`/claims/${claimId}/similar`),
  join: (claimId: string) => call<SimilarReports>(`/claims/${claimId}/join`, { method: 'POST', body: JSON.stringify({ consent: true }) }),
  leave: (claimId: string) => call<SimilarReports>(`/claims/${claimId}/join`, { method: 'DELETE' }),
  review: (claimId: string, decision: 'APPROVED' | 'REJECTED', note?: string) =>
    call(`/claims/${claimId}/review`, { method: 'PATCH', body: JSON.stringify({ decision, note }) }),
};
