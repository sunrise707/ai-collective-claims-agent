import { Inject, Injectable } from '@nestjs/common';
import { CaseRecord, CaseSummary, Category, ClaimRecord, ParticipantRecord } from '../../domain/types';
import { NewClaim, REPOSITORY, Repository } from '../../storage/repository';
import { normalizeCompany } from '../guardrails';

@Injectable()
export class CaseRegistryTool {
  readonly name = 'case_registry';

  constructor(@Inject(REPOSITORY) private readonly repo: Repository) {}

  registerParticipant(input: { name: string; email: string }): Promise<ParticipantRecord> {
    return this.repo.upsertParticipant(input);
  }

  listClaims(): Promise<ClaimRecord[]> {
    return this.repo.listClaims();
  }

  assignCase(company: string, category: Category): Promise<CaseRecord> {
    return this.repo.findOrCreateCase({ companyKey: normalizeCompany(company), company: company.trim(), category });
  }

  registerClaim(data: NewClaim): Promise<ClaimRecord> {
    return this.repo.createClaim(data);
  }

  getCase(id: string): Promise<CaseRecord | null> {
    return this.repo.getCase(id);
  }

  caseClaims(caseId: string): Promise<ClaimRecord[]> {
    return this.repo.listClaims({ caseId });
  }

  saveSummary(caseId: string, summary: CaseSummary): Promise<CaseRecord> {
    return this.repo.saveCaseSummary(caseId, summary);
  }
}
