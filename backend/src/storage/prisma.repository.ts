import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  AgentRunRecord,
  CaseRecord,
  CaseSummary,
  Category,
  ClaimRecord,
  ExtractedFacts,
  TraceStep,
} from '../domain/types';
import { ClaimPatch, NewClaim, Repository } from './repository';

@Injectable()
export class PrismaRepository implements Repository, OnModuleDestroy {
  private readonly db = new PrismaClient();

  onModuleDestroy() {
    return this.db.$disconnect();
  }

  upsertParticipant(input: { name: string; email: string }) {
    return this.db.participant.upsert({ where: { email: input.email }, update: {}, create: input });
  }

  getParticipant(id: string) {
    return this.db.participant.findUnique({ where: { id } });
  }

  async createClaim(data: NewClaim) {
    const row = await this.db.claim.create({
      data: {
        participantId: data.participantId,
        caseId: data.caseId,
        description: data.description,
        documentText: data.documentText,
        company: data.company,
        category: data.category,
        categoryConfidence: data.categoryConfidence,
        extracted: data.extracted as unknown as Prisma.InputJsonValue,
        missingFields: data.missingFields,
        flags: data.flags,
        status: data.status,
        duplicateOfId: data.duplicateOfId,
      },
    });
    return toClaim(row);
  }

  async getClaim(id: string) {
    const row = await this.db.claim.findUnique({ where: { id } });
    return row ? toClaim(row) : null;
  }

  async listClaims(filter?: { caseId?: string }) {
    const rows = await this.db.claim.findMany({ where: filter, orderBy: { createdAt: 'asc' } });
    return rows.map(toClaim);
  }

  async updateClaim(id: string, patch: ClaimPatch) {
    return toClaim(await this.db.claim.update({ where: { id }, data: patch }));
  }

  async findOrCreateCase(input: { companyKey: string; company: string; category: Category }) {
    const row = await this.db.case.upsert({
      where: { companyKey_category: { companyKey: input.companyKey, category: input.category } },
      update: {},
      create: input,
    });
    return toCase(row);
  }

  async getCase(id: string) {
    const row = await this.db.case.findUnique({ where: { id } });
    return row ? toCase(row) : null;
  }

  async listCases() {
    const rows = await this.db.case.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(toCase);
  }

  async saveCaseSummary(id: string, summary: CaseSummary) {
    const row = await this.db.case.update({
      where: { id },
      data: { summary: summary as unknown as Prisma.InputJsonValue, summaryAt: new Date() },
    });
    return toCase(row);
  }

  async saveRun(run: Omit<AgentRunRecord, 'id' | 'createdAt'>) {
    const row = await this.db.agentRun.create({
      data: {
        claimId: run.claimId,
        trace: run.trace as unknown as Prisma.InputJsonValue,
        outcome: run.outcome as Prisma.InputJsonValue,
        durationMs: run.durationMs,
      },
    });
    return toRun(row);
  }

  async listRunsForClaim(claimId: string) {
    const rows = await this.db.agentRun.findMany({ where: { claimId }, orderBy: { createdAt: 'asc' } });
    return rows.map(toRun);
  }
}

type ClaimRow = Prisma.ClaimGetPayload<object>;
type CaseRow = Prisma.CaseGetPayload<object>;
type RunRow = Prisma.AgentRunGetPayload<object>;

const toClaim = (row: ClaimRow): ClaimRecord => ({
  ...row,
  category: row.category as Category,
  extracted: row.extracted as unknown as ExtractedFacts,
});

const toCase = (row: CaseRow): CaseRecord => ({
  ...row,
  category: row.category as Category,
  summary: row.summary as unknown as CaseSummary | null,
});

const toRun = (row: RunRow): AgentRunRecord => ({
  ...row,
  trace: row.trace as unknown as TraceStep[],
});
