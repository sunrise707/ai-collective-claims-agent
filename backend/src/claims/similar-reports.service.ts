import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ClaimRecord } from '../domain/types';
import { REPOSITORY, Repository } from '../storage/repository';

export interface SimilarReportsView {
  claimId: string;
  eligible: boolean;
  reason: string | null;
  case: { company: string; category: string } | null;
  otherParticipants: number;
  otherParticipantsJoined: number;
  period: { from: string | null; to: string | null };
  joined: boolean;
  joinedAt: Date | null;
}

@Injectable()
export class SimilarReportsService {
  constructor(@Inject(REPOSITORY) private readonly repo: Repository) {}

  async view(claimId: string): Promise<SimilarReportsView> {
    return this.build(await this.resolve(claimId));
  }

  async join(claimId: string): Promise<SimilarReportsView> {
    const claim = await this.resolve(claimId);
    const reason = this.ineligibleReason(claim);
    if (reason) throw new ConflictException(reason);
    const updated = claim.joinedAt ? claim : await this.repo.updateClaim(claim.id, { joinedAt: new Date() });
    return this.build(updated);
  }

  async leave(claimId: string): Promise<SimilarReportsView> {
    const claim = await this.resolve(claimId);
    const updated = claim.joinedAt ? await this.repo.updateClaim(claim.id, { joinedAt: null }) : claim;
    return this.build(updated);
  }

  private async resolve(claimId: string): Promise<ClaimRecord> {
    const claim = await this.repo.getClaim(claimId);
    if (!claim) throw new NotFoundException('Claim not found');
    if (claim.status === 'DUPLICATE' && claim.duplicateOfId) {
      const original = await this.repo.getClaim(claim.duplicateOfId);
      if (original) return original;
    }
    return claim;
  }

  private ineligibleReason(claim: ClaimRecord): string | null {
    if (claim.reviewStatus === 'REJECTED') return 'This claim was rejected by the legal team.';
    if (claim.status === 'FLAGGED') return 'This claim is waiting for a manual check by the legal team.';
    if (!claim.caseId) return 'Add the missing information first so that the claim can be grouped with similar ones.';
    return null;
  }

  private async build(claim: ClaimRecord): Promise<SimilarReportsView> {
    const reason = this.ineligibleReason(claim);
    const base: SimilarReportsView = {
      claimId: claim.id,
      eligible: reason === null,
      reason,
      case: null,
      otherParticipants: 0,
      otherParticipantsJoined: 0,
      period: { from: null, to: null },
      joined: claim.joinedAt !== null,
      joinedAt: claim.joinedAt,
    };
    if (reason || !claim.caseId) return base;

    const caseRecord = await this.repo.getCase(claim.caseId);
    if (!caseRecord) return base;

    const others = (await this.repo.listClaims({ caseId: claim.caseId })).filter(
      (c) => c.participantId !== claim.participantId && c.status === 'READY_FOR_REVIEW' && c.reviewStatus !== 'REJECTED',
    );
    const participants = new Set(others.map((c) => c.participantId));
    const joined = new Set(others.filter((c) => c.joinedAt).map((c) => c.participantId));
    const dates = others.map((c) => c.extracted.incidentDate).filter((d): d is string => !!d).sort();

    return {
      ...base,
      case: { company: caseRecord.company, category: caseRecord.category },
      otherParticipants: participants.size,
      otherParticipantsJoined: joined.size,
      period: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
    };
  }
}
