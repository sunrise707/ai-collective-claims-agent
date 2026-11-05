import { DuplicateDetectorTool, similarity } from '../../src/agent/tools/duplicate-detector.tool';
import { ClaimRecord } from '../../src/domain/types';

function claim(over: Partial<ClaimRecord>): ClaimRecord {
  return {
    id: 'c1',
    participantId: 'p1',
    caseId: null,
    description: 'Acme charged me twice for my internet plan and refused a refund',
    documentText: null,
    company: 'Acme Telecom',
    category: 'BILLING_OVERCHARGE',
    categoryConfidence: 0.8,
    extracted: { company: 'Acme Telecom', incidentDate: '2025-03-03', amount: 49.99, currency: 'USD', productOrService: null, keyFacts: [] },
    missingFields: [],
    flags: [],
    status: 'READY_FOR_REVIEW',
    duplicateOfId: null,
    reviewStatus: 'PENDING',
    reviewNote: null,
    joinedAt: null,
    createdAt: new Date(),
    ...over,
  };
}

const detector = new DuplicateDetectorTool(0.6);
const input = {
  participantId: 'p1',
  company: 'ACME Telecom Inc.',
  category: 'BILLING_OVERCHARGE' as const,
  incidentDate: '2025-03-03',
  description: 'Acme charged me twice for my internet plan and refused a refund',
};

describe('similarity', () => {
  it('is 1 for identical text, 0 for unrelated text', () => {
    expect(similarity('double charge on invoice', 'double charge on invoice')).toBe(1);
    expect(similarity('double charge on invoice', 'blender caught fire')).toBe(0);
  });
});

describe('DuplicateDetectorTool', () => {
  it('detects the same participant resubmitting the same text', () => {
    const r = detector.run({ ...input, existing: [claim({})] });
    expect(r.duplicateOfId).toBe('c1');
  });

  it('detects the same participant, company, category and incident date even with different wording', () => {
    const r = detector.run({ ...input, description: 'Unexpected extra payment taken from my card', existing: [claim({})] });
    expect(r.duplicateOfId).toBe('c1');
    expect(r.reason).toMatch(/incident date/);
  });

  it('does NOT treat a different participant with the same text as a duplicate - it is a similar claim', () => {
    const r = detector.run({ ...input, participantId: 'p2', existing: [claim({})] });
    expect(r.duplicateOfId).toBeNull();
    expect(r.similar).toEqual([{ claimId: 'c1', similarity: 1, sameParticipant: false }]);
  });

  it('ignores other companies and claims that are themselves duplicates', () => {
    const r = detector.run({
      ...input,
      existing: [claim({ company: 'Zenith Appliances' }), claim({ id: 'c2', status: 'DUPLICATE' })],
    });
    expect(r.duplicateOfId).toBeNull();
    expect(r.similar).toEqual([]);
  });

  it('treats a second, different incident of the same participant as a new claim', () => {
    const r = detector.run({
      ...input,
      incidentDate: '2025-06-01',
      description: 'Router replacement never delivered after payment',
      existing: [claim({})],
    });
    expect(r.duplicateOfId).toBeNull();
  });

  it('never matches when the company is unknown', () => {
    expect(detector.run({ ...input, company: null, existing: [claim({})] }).duplicateOfId).toBeNull();
  });
});
