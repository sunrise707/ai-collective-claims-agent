import { ExtractedFacts } from '../domain/types';

export const REQUIRED_FIELDS = ['company', 'incidentDate', 'amountOrEvidence'] as const;
export type RequiredField = (typeof REQUIRED_FIELDS)[number];

const QUESTIONS: Record<RequiredField, string> = {
  company: 'Which company is your complaint about?',
  incidentDate: 'On what date did the problem happen (or start)?',
  amountOrEvidence: 'How much money did you lose or pay, or can you attach a document (receipt, e-mail, contract) that supports your claim?',
};

export interface CompletenessResult {
  missingFields: RequiredField[];
  followUpQuestions: string[];
}

export function checkCompleteness(facts: ExtractedFacts, hasDocument: boolean): CompletenessResult {
  const missingFields: RequiredField[] = [];
  if (!facts.company) missingFields.push('company');
  if (!facts.incidentDate) missingFields.push('incidentDate');
  if (facts.amount === null && !hasDocument) missingFields.push('amountOrEvidence');
  return { missingFields, followUpQuestions: missingFields.map((f) => QUESTIONS[f]) };
}
