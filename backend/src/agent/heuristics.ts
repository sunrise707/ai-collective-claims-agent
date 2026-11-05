import { Category, Classification, ExtractedFacts } from '../domain/types';

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const CURRENCY_SYMBOLS: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP', '₴': 'UAH' };

function isoDate(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

export function extractDate(text: string): string | null {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const r = isoDate(+iso[1], +iso[2], +iso[3]);
    if (r) return r;
  }
  const dotted = text.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  if (dotted) {
    const r = isoDate(+dotted[3], +dotted[2], +dotted[1]);
    if (r) return r;
  }
  const slashed = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (slashed) {
    const [a, b] = [+slashed[1], +slashed[2]];
    const r = a > 12 ? isoDate(+slashed[3], b, a) : isoDate(+slashed[3], a, b);
    if (r) return r;
  }
  const monthNames = MONTHS.join('|');
  const mdy = text.match(new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'i'));
  if (mdy) {
    const r = isoDate(+mdy[3], MONTHS.indexOf(mdy[1].toLowerCase()) + 1, +mdy[2]);
    if (r) return r;
  }
  const dmy = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames}),?\\s+(\\d{4})\\b`, 'i'));
  if (dmy) {
    const r = isoDate(+dmy[3], MONTHS.indexOf(dmy[2].toLowerCase()) + 1, +dmy[1]);
    if (r) return r;
  }
  return null;
}

export function extractAmount(text: string): { amount: number; currency: string } | null {
  const prefix = text.match(/([$€£₴]|\b(?:USD|EUR|GBP|UAH)\b)\s?(\d[\d,]*(?:\.\d{1,2})?)/i);
  const suffix = text.match(/(\d[\d,]*(?:\.\d{1,2})?)\s?(USD|EUR|GBP|UAH|dollars|euros)\b/i);
  const m = prefix ?? suffix;
  if (!m) return null;
  const rawCurrency = (prefix ? m[1] : m[2]).toUpperCase();
  const rawAmount = prefix ? m[2] : m[1];
  const currency = CURRENCY_SYMBOLS[rawCurrency] ?? (rawCurrency === 'DOLLARS' ? 'USD' : rawCurrency === 'EUROS' ? 'EUR' : rawCurrency);
  const amount = Number(rawAmount.replace(/,/g, ''));
  return Number.isFinite(amount) ? { amount, currency } : null;
}

const NOT_COMPANY = new Set(['the', 'i', 'my', 'we', 'on', 'in', 'it', 'they', 'this', 'that', 'after', 'when']);

export function extractCompany(text: string): string | null {
  const labelled = text.match(/\b(?:company|vendor|seller|provider|merchant)\s*[:\-]\s*([^\n,.;]{2,60})/i);
  if (labelled) return labelled[1].trim();
  const re = /\b(?:from|at|by|against|with|charged by|bought from|purchased from|customer of|subscriber of)\s+([A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*){0,3})/g;
  for (const m of text.matchAll(re)) {
    const candidate = m[1].trim();
    const first = candidate.split(' ')[0].toLowerCase();
    if (!NOT_COMPANY.has(first) && !MONTHS.includes(first)) return candidate;
  }
  return null;
}

export function extractProduct(text: string): string | null {
  const m = text.match(/\b(?:bought|purchased|subscribed to|ordered|signed up for)\s+(?:a|an|the|my)?\s*([\w][\w\s-]{2,40}?)(?=\s+(?:from|on|in|at|for|and|but|which|that)\b|[.,;])/i);
  return m ? m[1].trim() : null;
}

export function extractFactsHeuristic(text: string, hintedCompany?: string | null): ExtractedFacts {
  const money = extractAmount(text);
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const factual = sentences.filter((s) => /\d/.test(s));
  const keyFacts = (factual.length ? factual : sentences).slice(0, 4).map((s) => s.slice(0, 300));
  return {
    company: hintedCompany?.trim() || extractCompany(text),
    incidentDate: extractDate(text),
    amount: money?.amount ?? null,
    currency: money?.currency ?? null,
    productOrService: extractProduct(text),
    keyFacts,
  };
}

const KEYWORDS: Record<Exclude<Category, 'OTHER'>, RegExp[]> = {
  PRODUCT_DEFECT: [/defect/i, /broke/i, /malfunction/i, /faulty/i, /stopped working/i, /overheat/i, /recall/i, /caught fire/i, /unsafe/i, /damaged/i, /punctur/i, /\bholes?\b/i, /shrapnel/i],
  FALSE_ADVERTISING: [/advertis/i, /misleading/i, /promised/i, /marketing/i, /deceptive/i, /not as described/i, /false claim/i, /claimed (it|that)/i],
  BILLING_OVERCHARGE: [/overcharg/i, /charged (me )?twice/i, /double[- ]charg/i, /hidden fee/i, /extra fee/i, /billing/i, /unauthori[sz]ed charge/i, /refund/i, /invoice/i],
  DATA_PRIVACY: [/data breach/i, /leak/i, /privacy/i, /personal data/i, /gdpr/i, /without (my )?consent/i, /hacked/i, /tracking/i, /shared my (data|information)/i],
  CONTRACT_BREACH: [/contract/i, /agreement/i, /terms of service/i, /warranty/i, /breach/i, /unilateral/i, /cancel/i],
  SERVICE_FAILURE: [/outage/i, /downtime/i, /never (arrived|delivered)/i, /delay/i, /unavailable/i, /support (never|did not|didn't)/i, /not delivered/i, /refused to (accept|take|receive)/i, /(did not|didn't|never) (respond|reply|answer)/i],
};

export function classifyHeuristic(text: string): Classification {
  const scores = (Object.keys(KEYWORDS) as (keyof typeof KEYWORDS)[])
    .map((category) => ({ category, score: KEYWORDS[category].filter((re) => re.test(text)).length }))
    .sort((a, b) => b.score - a.score);
  const [best, second] = scores;
  if (best.score === 0) {
    return { category: 'OTHER', confidence: 0.3, rationale: 'No category keywords matched (heuristic fallback).' };
  }
  const margin = best.score - (second?.score ?? 0);
  const confidence = Math.min(0.9, 0.4 + 0.1 * best.score + 0.1 * margin);
  return {
    category: best.category,
    confidence: Math.round(confidence * 100) / 100,
    rationale: `Matched ${best.score} keyword(s) for ${best.category} (heuristic fallback).`,
  };
}
