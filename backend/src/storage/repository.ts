import {
  AgentRunRecord,
  CaseRecord,
  CaseSummary,
  Category,
  ClaimRecord,
  ParticipantRecord,
} from '../domain/types';

export const REPOSITORY = Symbol('REPOSITORY');

export type NewClaim = Omit<ClaimRecord, 'id' | 'createdAt' | 'reviewStatus' | 'reviewNote' | 'joinedAt'>;
export type ClaimPatch = Partial<Pick<ClaimRecord, 'reviewStatus' | 'reviewNote' | 'caseId' | 'joinedAt'>>;

export interface Repository {
  upsertParticipant(input: { name: string; email: string }): Promise<ParticipantRecord>;
  getParticipant(id: string): Promise<ParticipantRecord | null>;

  createClaim(data: NewClaim): Promise<ClaimRecord>;
  getClaim(id: string): Promise<ClaimRecord | null>;
  listClaims(filter?: { caseId?: string }): Promise<ClaimRecord[]>;
  updateClaim(id: string, patch: ClaimPatch): Promise<ClaimRecord>;

  findOrCreateCase(input: { companyKey: string; company: string; category: Category }): Promise<CaseRecord>;
  getCase(id: string): Promise<CaseRecord | null>;
  listCases(): Promise<CaseRecord[]>;
  saveCaseSummary(id: string, summary: CaseSummary): Promise<CaseRecord>;

  saveRun(run: Omit<AgentRunRecord, 'id' | 'createdAt'>): Promise<AgentRunRecord>;
  listRunsForClaim(claimId: string): Promise<AgentRunRecord[]>;
}
