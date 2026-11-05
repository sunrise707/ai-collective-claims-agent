import { checkCompleteness } from '../../src/agent/completeness';
import { classifyHeuristic, extractAmount, extractDate, extractFactsHeuristic } from '../../src/agent/heuristics';

describe('extractDate', () => {
  it.each([
    ['happened on 2025-03-03', '2025-03-03'],
    ['on 14.02.2025 it broke', '2025-02-14'],
    ['on 03/21/2025 I paid', '2025-03-21'],
    ['on 14 February 2025 it broke', '2025-02-14'],
    ['on March 3rd, 2025 I paid', '2025-03-03'],
  ])('%s', (text, expected) => expect(extractDate(text)).toBe(expected));

  it('rejects impossible dates and returns null when absent', () => {
    expect(extractDate('on 2025-02-31')).toBeNull();
    expect(extractDate('last spring')).toBeNull();
  });
});

describe('extractAmount', () => {
  it.each([
    ['charged $49.99 twice', 49.99, 'USD'],
    ['paid 89 EUR', 89, 'EUR'],
    ['lost €1,299.50', 1299.5, 'EUR'],
  ])('%s', (text, amount, currency) => expect(extractAmount(text)).toEqual({ amount, currency }));

  it('returns null without money', () => expect(extractAmount('no numbers here')).toBeNull());
});

describe('classifyHeuristic', () => {
  it('classifies by keywords', () => {
    expect(classifyHeuristic('double charge and no refund on my invoice').category).toBe('BILLING_OVERCHARGE');
    expect(classifyHeuristic('the blender overheated, product is defective').category).toBe('PRODUCT_DEFECT');
    expect(classifyHeuristic('they shared my personal data without consent').category).toBe('DATA_PRIVACY');
  });

  it('falls back to OTHER with low confidence', () => {
    const r = classifyHeuristic('something odd happened');
    expect(r.category).toBe('OTHER');
    expect(r.confidence).toBeLessThan(0.5);
  });
});

describe('extractFactsHeuristic', () => {
  it('prefers the company typed in the form', () => {
    const facts = extractFactsHeuristic('Charged $10 on 2025-01-05 by Foo Corp.', 'Bar Ltd');
    expect(facts.company).toBe('Bar Ltd');
    expect(facts.amount).toBe(10);
    expect(facts.incidentDate).toBe('2025-01-05');
  });
});

describe('checkCompleteness', () => {
  const base = { company: 'Acme', incidentDate: '2025-03-03', amount: 10, currency: 'USD', productOrService: null, keyFacts: [] };

  it('is complete with company, date and an amount', () => {
    expect(checkCompleteness(base, false).missingFields).toEqual([]);
  });

  it('accepts a document instead of an amount', () => {
    expect(checkCompleteness({ ...base, amount: null, currency: null }, true).missingFields).toEqual([]);
  });

  it('lists what is missing and prepares a question for each', () => {
    const r = checkCompleteness({ ...base, company: null, incidentDate: null, amount: null, currency: null }, false);
    expect(r.missingFields).toEqual(['company', 'incidentDate', 'amountOrEvidence']);
    expect(r.followUpQuestions).toHaveLength(3);
  });
});

describe('classifyHeuristic - delivery scenarios', () => {
  it('recognises a boiler damaged in transit', () => {
    expect(classifyHeuristic('sealed box, but small holes from shrapnel; the boiler is damaged and unsafe').category).toBe('PRODUCT_DEFECT');
  });

  it('recognises a refused return as a service failure', () => {
    expect(classifyHeuristic('the branch refused to accept the sealed parcel back and the sender did not respond').category).toBe('SERVICE_FAILURE');
  });
});
