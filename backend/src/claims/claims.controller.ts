import { BadRequestException, Body, Controller, Delete, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { ClaimsAgent } from '../agent/claims-agent';
import { CaseRegistryTool } from '../agent/tools/case-registry.tool';
import { CaseSummaryTool } from '../agent/tools/case-summary.tool';
import { ClaimInputSchema } from '../domain/types';
import { REPOSITORY, Repository } from '../storage/repository';
import { SimilarReportsService } from './similar-reports.service';

const ReviewSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().trim().max(1000).optional(),
});

const JoinSchema = z.object({
  consent: z.literal(true, { errorMap: () => ({ message: 'Explicit consent is required to join' }) }),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException({
      message: 'Invalid input',
      issues: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}

@Controller()
export class ClaimsController {
  constructor(
    private readonly agent: ClaimsAgent,
    private readonly registry: CaseRegistryTool,
    private readonly summarizer: CaseSummaryTool,
    private readonly similarReports: SimilarReportsService,
    @Inject(REPOSITORY) private readonly repo: Repository,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Post('claims')
  submit(@Body() body: unknown) {
    return this.agent.process(parse(ClaimInputSchema, body));
  }

  @Get('claims')
  async listClaims() {
    return this.repo.listClaims();
  }

  @Get('claims/:id')
  async getClaim(@Param('id', ParseUUIDPipe) id: string) {
    const claim = await this.repo.getClaim(id);
    if (!claim) throw new NotFoundException('Claim not found');
    const [participant, runs] = await Promise.all([this.repo.getParticipant(claim.participantId), this.repo.listRunsForClaim(id)]);
    return { claim, participant, runs };
  }

  @Get('claims/:id/similar')
  similar(@Param('id', ParseUUIDPipe) id: string) {
    return this.similarReports.view(id);
  }

  @Post('claims/:id/join')
  join(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    parse(JoinSchema, body);
    return this.similarReports.join(id);
  }

  @Delete('claims/:id/join')
  leave(@Param('id', ParseUUIDPipe) id: string) {
    return this.similarReports.leave(id);
  }

  @Patch('claims/:id/review')
  async review(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { decision, note } = parse(ReviewSchema, body);
    if (!(await this.repo.getClaim(id))) throw new NotFoundException('Claim not found');
    const claim = await this.repo.updateClaim(id, { reviewStatus: decision, reviewNote: note ?? null });
    if (claim.caseId) await this.refreshSummary(claim.caseId);
    return claim;
  }

  @Get('cases')
  async listCases() {
    const cases = await this.repo.listCases();
    return Promise.all(
      cases.map(async (c) => ({ ...c, claimCount: (await this.repo.listClaims({ caseId: c.id })).filter((x) => x.status !== 'DUPLICATE').length })),
    );
  }

  @Get('cases/:id')
  async getCase(@Param('id', ParseUUIDPipe) id: string) {
    const caseRecord = await this.repo.getCase(id);
    if (!caseRecord) throw new NotFoundException('Case not found');
    const claims = await this.repo.listClaims({ caseId: id });
    const participants = new Map<string, { name: string; email: string }>();
    for (const c of claims) {
      const p = await this.repo.getParticipant(c.participantId);
      if (p) participants.set(p.id, { name: p.name, email: p.email });
    }
    return { case: caseRecord, claims: claims.map((c) => ({ ...c, participant: participants.get(c.participantId) ?? null })) };
  }

  @Post('cases/:id/summary')
  async regenerateSummary(@Param('id', ParseUUIDPipe) id: string) {
    if (!(await this.repo.getCase(id))) throw new NotFoundException('Case not found');
    return this.refreshSummary(id);
  }

  private async refreshSummary(caseId: string) {
    const caseRecord = (await this.registry.getCase(caseId))!;
    const res = await this.summarizer.run(caseRecord, await this.registry.caseClaims(caseId));
    await this.registry.saveSummary(caseId, res.data);
    return res.data;
  }
}

