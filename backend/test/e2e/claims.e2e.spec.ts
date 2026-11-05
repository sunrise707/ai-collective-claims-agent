import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { LLM_CLIENT } from '../../src/llm/llm.types';
import { FakeLlm } from '../helpers/fake-llm';

Logger.overrideLogger(false);

const SAMPLES = path.resolve(__dirname, '../../../samples');
const expected: Record<string, any> = JSON.parse(fs.readFileSync(path.join(SAMPLES, 'expected.json'), 'utf8'));
const sample = (file: string) => JSON.parse(fs.readFileSync(path.join(SAMPLES, 'claims', file), 'utf8'));

async function createApp(llm?: unknown): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (llm) builder = builder.overrideProvider(LLM_CLIENT).useValue(llm);
  const app = (await builder.compile()).createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  return app;
}

describe('Claims agent - end to end (offline heuristics, in-memory storage)', () => {
  let app: INestApplication;
  const claimIdByFile: Record<string, string> = {};
  const results: Record<string, any> = {};

  beforeAll(async () => {
    app = await createApp();
    for (const file of Object.keys(expected)) {
      const res = await request(app.getHttpServer()).post('/api/claims').send(sample(file)).expect(201);
      results[file] = res.body;
      claimIdByFile[file] = res.body.claimId;
    }
  });
  afterAll(() => app.close());

  it.each(Object.keys(expected))('%s produces the expected structured result', (file) => {
    const want = expected[file];
    const got = results[file];
    expect(got.status).toBe(want.status);
    expect(got.category).toBe(want.category);
    expect(got.requiresHumanReview).toBe(true);
    if (want.missingFields) expect(got.missingFields).toEqual(want.missingFields);
    if (want.flags) expect(got.flags).toEqual(expect.arrayContaining(want.flags));
    if (want.duplicateOf) expect(got.duplicateOfId).toBe(claimIdByFile[want.duplicateOf]);
    expect(got.case ? `${got.case.company} / ${got.case.category}` : null).toBe(want.caseKey);
  });

  it('records every workflow step and tool call in the trace', () => {
    const steps = results['01-boiler-damaged-shrapnel.json'].trace.map((s: any) => s.step);
    expect(steps).toEqual([
      'guardrails', 'analyze_document', 'classify_claim', 'check_completeness',
      'register_participant', 'detect_duplicates', 'register_claim', 'update_case_summary',
    ]);
    expect(results['01-boiler-damaged-shrapnel.json'].trace.find((s: any) => s.step === 'analyze_document')).toMatchObject({
      tool: 'document_analyzer', status: 'fallback',
    });
  });

  it('links similar claims of other participants instead of dropping them', () => {
    expect(results['02-boiler-damaged-second-customer.json'].similarClaims.map((s: any) => s.claimId)).toContain(claimIdByFile['01-boiler-damaged-shrapnel.json']);
  });

  it('links similar claims of different buyers about the same problem', () => {
    expect(results['08-nova-poshta-return-refused-second-customer.json'].similarClaims.map((s: any) => s.claimId)).toContain(
      claimIdByFile['07-nova-poshta-return-refused.json'],
    );
    expect(results['10-samsung-washer-damaged-second-customer.json'].similarClaims.map((s: any) => s.claimId)).toContain(
      claimIdByFile['09-samsung-washer-damaged-shrapnel.json'],
    );
    expect(results['05-boiler-heating-time-injection.json'].similarClaims.map((s: any) => s.claimId)).toContain(
      claimIdByFile['04-boiler-heating-time-warranty.json'],
    );
  });

  it('prepares follow-up questions for incomplete claims', () => {
    expect(results['06-boiler-damaged-needs-info.json'].followUpQuestions).toHaveLength(3);
  });

  it('treats injected instructions as data: flags the claim and still classifies by content', () => {
    const r = results['05-boiler-heating-time-injection.json'];
    expect(r.status).toBe('FLAGGED');
    expect(r.decision).toMatch(/manual check/);
    expect(r.decision).not.toMatch(/approved/i);
  });

  it('never states a legal assessment', () => {
    for (const r of Object.values(results)) expect(r.decision).toMatch(/No legal assessment was made/);
  });

  it('groups claims by company + category and excludes duplicates from the case', async () => {
    const list = await request(app.getHttpServer()).get('/api/cases').expect(200);
    expect(list.body.map((c: any) => `${c.company} / ${c.category}`).sort()).toEqual([
      'NOVA POSHTA / SERVICE_FAILURE',
      'SAMSUNG / PRODUCT_DEFECT',
      'SWAN / FALSE_ADVERTISING',
      'SWAN / PRODUCT_DEFECT',
    ]);
    const damaged = list.body.find((c: any) => c.company === 'SWAN' && c.category === 'PRODUCT_DEFECT');
    const detail = (await request(app.getHttpServer()).get(`/api/cases/${damaged.id}`).expect(200)).body;
    expect(detail.claims).toHaveLength(2);
    expect(detail.case.summary.stats).toMatchObject({ totalClaims: 2, readyForReview: 2, flagged: 0, totalAmountByCurrency: { UAH: 24200 } });
    expect(detail.case.summary.disclaimer).toMatch(/NOT a legal assessment/);
  });

  it('human-in-the-loop: a reviewer rejects a claim and the summary is refreshed without it', async () => {
    const id = claimIdByFile['05-boiler-heating-time-injection.json'];
    await request(app.getHttpServer()).patch(`/api/claims/${id}/review`).send({ decision: 'REJECTED', note: 'prompt injection' }).expect(200);
    const claim = (await request(app.getHttpServer()).get(`/api/claims/${id}`).expect(200)).body;
    expect(claim.claim).toMatchObject({ reviewStatus: 'REJECTED', reviewNote: 'prompt injection' });
    expect(claim.runs).toHaveLength(1);
    const caseId = results['04-boiler-heating-time-warranty.json'].case.id;
    const detail = (await request(app.getHttpServer()).get(`/api/cases/${caseId}`).expect(200)).body;
    expect(detail.case.summary.stats).toMatchObject({ totalClaims: 1, readyForReview: 1, flagged: 0 });
  });

  describe('participant view: similar reports and joining', () => {
    const http = () => request(app.getHttpServer());

    it('shows how many OTHER people reported a similar problem, without exposing their data', async () => {
      const res = await http().get(`/api/claims/${claimIdByFile['02-boiler-damaged-second-customer.json']}/similar`).expect(200);
      expect(res.body).toMatchObject({
        eligible: true,
        case: { company: 'SWAN', category: 'PRODUCT_DEFECT' },
        otherParticipants: 1,
        otherParticipantsJoined: 0,
        period: { from: '2025-10-14', to: '2025-10-14' },
        joined: false,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/olena|bondarenko|@example\.com/i);
    });

    it('requires explicit consent to join', async () => {
      const id = claimIdByFile['01-boiler-damaged-shrapnel.json'];
      await http().post(`/api/claims/${id}/join`).send({}).expect(400);
      await http().post(`/api/claims/${id}/join`).send({ consent: false }).expect(400);
    });

    it('lets a participant join, is visible to the other participant and to the legal team, and can be withdrawn', async () => {
      const olena = claimIdByFile['01-boiler-damaged-shrapnel.json'];
      const maksym = claimIdByFile['02-boiler-damaged-second-customer.json'];

      const joined = await http().post(`/api/claims/${olena}/join`).send({ consent: true }).expect(201);
      expect(joined.body).toMatchObject({ joined: true, otherParticipants: 1, otherParticipantsJoined: 0 });
      await http().post(`/api/claims/${olena}/join`).send({ consent: true }).expect(201);

      const seenByMaksym = await http().get(`/api/claims/${maksym}/similar`).expect(200);
      expect(seenByMaksym.body.otherParticipantsJoined).toBe(1);

      const detail = (await http().get(`/api/cases/${results['01-boiler-damaged-shrapnel.json'].case.id}`).expect(200)).body;
      expect(detail.claims.filter((c: any) => c.joinedAt).map((c: any) => c.id)).toEqual([olena]);

      const left = await http().delete(`/api/claims/${olena}/join`).expect(200);
      expect(left.body.joined).toBe(false);
      expect((await http().get(`/api/claims/${maksym}/similar`).expect(200)).body.otherParticipantsJoined).toBe(0);
    });

    it('resolves a duplicate submission to the original claim', async () => {
      const dup = claimIdByFile['03-boiler-damaged-duplicate.json'];
      const res = await http().get(`/api/claims/${dup}/similar`).expect(200);
      expect(res.body.claimId).toBe(claimIdByFile['01-boiler-damaged-shrapnel.json']);
      expect(res.body.eligible).toBe(true);
    });

    it('does not offer joining for incomplete or flagged claims and reveals no counts for them', async () => {
      for (const file of ['06-boiler-damaged-needs-info.json', '05-boiler-heating-time-injection.json']) {
        const id = claimIdByFile[file];
        const view = (await http().get(`/api/claims/${id}/similar`).expect(200)).body;
        expect(view).toMatchObject({ eligible: false, otherParticipants: 0, case: null });
        expect(view.reason).toEqual(expect.any(String));
        await http().post(`/api/claims/${id}/join`).send({ consent: true }).expect(409);
      }
    });

    it('returns 404 for an unknown claim', async () => {
      await http().get('/api/claims/00000000-0000-4000-8000-000000000000/similar').expect(404);
    });
  });

  it('validates input and returns 400 with field-level errors', async () => {
    const res = await request(app.getHttpServer()).post('/api/claims').send({ participantName: 'A', email: 'nope', description: 'short' }).expect(400);
    expect(res.body.issues.map((i: any) => i.field).sort()).toEqual(['description', 'email', 'participantName']);
  });

  it('returns 404 / 400 for unknown or malformed ids', async () => {
    await request(app.getHttpServer()).get('/api/claims/not-a-uuid').expect(400);
    await request(app.getHttpServer()).get('/api/claims/00000000-0000-4000-8000-000000000000').expect(404);
  });
});

describe('Claims agent - LLM failure is handled gracefully', () => {
  it('completes the workflow with deterministic fallbacks when every LLM call fails', async () => {
    const llm = new FakeLlm({});
    const app = await createApp(llm);
    const res = await request(app.getHttpServer()).post('/api/claims').send(sample('01-boiler-damaged-shrapnel.json')).expect(201);
    expect(res.body.status).toBe('READY_FOR_REVIEW');
    expect(res.body.trace.filter((s: any) => s.status === 'fallback').map((s: any) => s.tool)).toEqual([
      'document_analyzer', 'claim_classifier', 'case_summary_generator',
    ]);
    expect(llm.calls).toEqual(['document_analyzer', 'claim_classifier', 'case_summary_generator']);
    await app.close();
  });

  it('uses valid LLM output when available', async () => {
    const llm = new FakeLlm({
      document_analyzer: () => ({ company: 'SWAN', incidentDate: '2025-10-14', amount: 11900, currency: 'UAH', productOrService: 'boiler', keyFacts: ['sealed box, holes found at home'] }),
      claim_classifier: () => ({ category: 'PRODUCT_DEFECT', confidence: 0.95, rationale: 'damaged boiler' }),
      case_summary_generator: () => ({ headline: 'Damaged boilers reported', overview: 'One participant reports a damaged boiler.', commonPatterns: [], openIssues: [] }),
    });
    const app = await createApp(llm);
    const res = await request(app.getHttpServer()).post('/api/claims').send(sample('01-boiler-damaged-shrapnel.json')).expect(201);
    expect(res.body.categoryConfidence).toBe(0.95);
    expect(res.body.trace.every((s: any) => s.status !== 'fallback')).toBe(true);
    await app.close();
  });
});
