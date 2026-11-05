import { CaseSummaryTool, computeStats } from '../../src/agent/tools/case-summary.tool';
import { ClaimClassifierTool } from '../../src/agent/tools/claim-classifier.tool';
import { DocumentAnalyzerTool } from '../../src/agent/tools/document-analyzer.tool';
import { CaseRecord, ClaimRecord } from '../../src/domain/types';
import { DisabledLlmClient } from '../../src/llm/openai-llm.client';
import { FakeLlm } from '../helpers/fake-llm';

const NOW = new Date('2025-06-01T00:00:00Z');

describe('DocumentAnalyzerTool', () => {
  it('uses the LLM result and applies deterministic sanity checks to it', async () => {
    const llm = new FakeLlm({
      document_analyzer: () => ({ company: 'Wrong Co', incidentDate: '2031-01-01', amount: 5e12, currency: 'usd', productOrService: null, keyFacts: ['x'] }),
    });
    const res = await new DocumentAnalyzerTool(llm).run({ description: 'text', company: 'Acme' }, NOW);
    expect(res.source).toBe('llm');
    expect(res.data.company).toBe('Acme');
    expect(res.data.incidentDate).toBeNull();
    expect(res.data.amount).toBeNull();
    expect(res.data.currency).toBeNull();
  });

  it('falls back to heuristics when the LLM output is unusable', async () => {
    const llm = new FakeLlm({ document_analyzer: () => ({ garbage: true }) });
    const res = await new DocumentAnalyzerTool(llm).run({ description: 'Acme charged me $20 on 2025-02-02.', company: 'Acme' }, NOW);
    expect(res.source).toBe('fallback');
    expect(res.data).toMatchObject({ amount: 20, incidentDate: '2025-02-02', company: 'Acme' });
  });

  it('works offline (no LLM configured)', async () => {
    const res = await new DocumentAnalyzerTool(new DisabledLlmClient()).run({ description: 'Paid 15 EUR on 2025-01-01 to Foo.' }, NOW);
    expect(res.source).toBe('fallback');
    expect(res.attempts).toBe(0);
  });
});

describe('ClaimClassifierTool', () => {
  const facts = { company: null, incidentDate: null, amount: null, currency: null, productOrService: null, keyFacts: [] };

  it('rejects categories outside the allowed list and falls back', async () => {
    const llm = new FakeLlm({ claim_classifier: () => ({ category: 'LEGALLY_VALID', confidence: 1, rationale: 'x' }) });
    const res = await new ClaimClassifierTool(llm).run({ description: 'double charge and refund missing', facts });
    expect(res.source).toBe('fallback');
    expect(res.data.category).toBe('BILLING_OVERCHARGE');
  });

  it('accepts a valid LLM classification', async () => {
    const llm = new FakeLlm({ claim_classifier: () => ({ category: 'DATA_PRIVACY', confidence: 0.9, rationale: 'leak' }) });
    const res = await new ClaimClassifierTool(llm).run({ description: 'whatever', facts });
    expect(res).toMatchObject({ source: 'llm', data: { category: 'DATA_PRIVACY' } });
  });
});

describe('CaseSummaryTool', () => {
  const caseRecord: CaseRecord = { id: 'case1', companyKey: 'acme', company: 'Acme', category: 'BILLING_OVERCHARGE', summary: null, summaryAt: null, createdAt: new Date() };
  const claim = (over: Partial<ClaimRecord>): ClaimRecord => ({
    id: 'aaaaaaaa-1', participantId: 'p', caseId: 'case1', description: 'd', documentText: null, company: 'Acme', category: 'BILLING_OVERCHARGE',
    categoryConfidence: 0.8, extracted: { company: 'Acme', incidentDate: '2025-03-03', amount: 10, currency: 'USD', productOrService: null, keyFacts: ['charged twice'] },
    missingFields: [], flags: [], status: 'READY_FOR_REVIEW', duplicateOfId: null, reviewStatus: 'PENDING', reviewNote: null, joinedAt: null, createdAt: new Date(), ...over,
  });
  const claims = [
    claim({ id: 'a1' }),
    claim({ id: 'a2', extracted: { company: 'Acme', incidentDate: '2025-04-01', amount: 5.5, currency: 'USD', productOrService: null, keyFacts: [] }, status: 'NEEDS_INFO' }),
    claim({ id: 'a3', status: 'DUPLICATE' }),
    claim({ id: 'a4', reviewStatus: 'REJECTED' }),
  ];

  it('computes statistics in code, excluding duplicates and rejected claims', () => {
    expect(computeStats(claims)).toEqual({
      totalClaims: 2, readyForReview: 1, needsInfo: 1, flagged: 0, duplicatesExcluded: 1,
      totalAmountByCurrency: { USD: 15.5 }, earliestIncident: '2025-03-03', latestIncident: '2025-04-01',
    });
  });

  it('uses the LLM narrative when it is neutral', async () => {
    const llm = new FakeLlm({
      case_summary_generator: () => ({ headline: 'Double charges reported', overview: 'Participants report double charges.', commonPatterns: ['double charge'], openIssues: [] }),
    });
    const res = await new CaseSummaryTool(llm).run(caseRecord, claims);
    expect(res.source).toBe('llm');
    expect(res.data.disclaimer).toMatch(/NOT a legal assessment/);
  });

  it('blocks an LLM narrative that states a legal conclusion and uses the template instead', async () => {
    const llm = new FakeLlm({
      case_summary_generator: () => ({ headline: 'Strong class action', overview: 'Acme is liable and participants have a strong case.', commonPatterns: [], openIssues: [] }),
    });
    const res = await new CaseSummaryTool(llm).run(caseRecord, claims);
    expect(res.source).toBe('fallback');
    expect(res.blockedLegalPhrases.length).toBeGreaterThan(0);
    expect(res.data.overview).not.toMatch(/liable/);
  });

  it('works offline with the template', async () => {
    const res = await new CaseSummaryTool(new DisabledLlmClient()).run(caseRecord, claims);
    expect(res.source).toBe('fallback');
    expect(res.data.stats.totalClaims).toBe(2);
  });
});
