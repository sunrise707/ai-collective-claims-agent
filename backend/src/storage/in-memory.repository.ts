import { randomUUID } from 'crypto';
import {
  AgentRunRecord,
  CaseRecord,
  CaseSummary,
  Category,
  ClaimRecord,
  ParticipantRecord,
} from '../domain/types';
import { ClaimPatch, NewClaim, Repository } from './repository';

export class InMemoryRepository implements Repository {
  private participants = new Map<string, ParticipantRecord>();
  private claims = new Map<string, ClaimRecord>();
  private cases = new Map<string, CaseRecord>();
  private runs: AgentRunRecord[] = [];

  async upsertParticipant(input: { name: string; email: string }) {
    const existing = [...this.participants.values()].find((p) => p.email === input.email);
    if (existing) return existing;
    const created: ParticipantRecord = { id: randomUUID(), ...input, createdAt: new Date() };
    this.participants.set(created.id, created);
    return created;
  }

  async getParticipant(id: string) {
    return this.participants.get(id) ?? null;
  }

  async createClaim(data: NewClaim) {
    const claim: ClaimRecord = {
      ...data,
      id: randomUUID(),
      reviewStatus: 'PENDING',
      reviewNote: null,
      joinedAt: null,
      createdAt: new Date(),
    };
    this.claims.set(claim.id, claim);
    return claim;
  }

  async getClaim(id: string) {
    return this.claims.get(id) ?? null;
  }

  async listClaims(filter?: { caseId?: string }) {
    const all = [...this.claims.values()];
    return filter?.caseId ? all.filter((c) => c.caseId === filter.caseId) : all;
  }

  async updateClaim(id: string, patch: ClaimPatch) {
    const claim = this.claims.get(id);
    if (!claim) throw new Error(`Claim ${id} not found`);
    const updated = { ...claim, ...patch };
    this.claims.set(id, updated);
    return updated;
  }

  async findOrCreateCase(input: { companyKey: string; company: string; category: Category }) {
    const existing = [...this.cases.values()].find(
      (c) => c.companyKey === input.companyKey && c.category === input.category,
    );
    if (existing) return existing;
    const created: CaseRecord = { id: randomUUID(), ...input, summary: null, summaryAt: null, createdAt: new Date() };
    this.cases.set(created.id, created);
    return created;
  }

  async getCase(id: string) {
    return this.cases.get(id) ?? null;
  }

  async listCases() {
    return [...this.cases.values()];
  }

  async saveCaseSummary(id: string, summary: CaseSummary) {
    const found = this.cases.get(id);
    if (!found) throw new Error(`Case ${id} not found`);
    const updated = { ...found, summary, summaryAt: new Date() };
    this.cases.set(id, updated);
    return updated;
  }

  async saveRun(run: Omit<AgentRunRecord, 'id' | 'createdAt'>) {
    const record: AgentRunRecord = { ...run, id: randomUUID(), createdAt: new Date() };
    this.runs.push(record);
    return record;
  }

  async listRunsForClaim(claimId: string) {
    return this.runs.filter((r) => r.claimId === claimId);
  }
}
