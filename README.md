# AI Collective Claims Agent

An AI agent that collects complaints from many people against the same company, organises them, and prepares a
case summary for a legal team. **The agent never decides whether a claim is legally valid** — it prepares
material, a legal professional decides (human-in-the-loop).

Stack: React + TypeScript (Vite) · NestJS · Claude API / OpenAI API · Zod · PostgreSQL + Prisma · Jest · Pino · Docker.

## The idea

People who bought the same product — or completely different products — run into similar problems, but each of them
faces the company **alone**. They don't know that hundreds of others have the same complaint, and a single claim is
usually too small or too hard to pursue. A collective claim only becomes possible when someone notices the pattern
and brings those people together.

This project is that "someone": a place where anyone can describe their problem, and an AI agent that
**finds similar incidents, links the people behind them, and groups them into one case** that a legal team can
work with — so that people can discover each other's reports and join a collective claim instead of giving up.

Example from the demo data (`samples/`):

- Olena and Maksym bought **SWAN boilers**, Oksana and Serhii bought **SAMSUNG washing machines**. Every one of them
  received a sealed **NOVA POSHTA** parcel and only at home found holes from shrapnel.
- Separately, none of them can tell what happened: was it the carrier, or did the warehouses near Brovary get hit
  before the goods were even shipped? Each only sees their own damaged box.
- Other buyers of the same boilers complain about something different (heating takes twice as long as advertised and
  the warranty does nothing), and others were refused a return of an unopened parcel by NOVA POSHTA.
- Through the system these reports become visible as patterns: same company + same problem → one case; the shared
  facts (carrier, sender warehouse location, period) are extracted so that **a lawyer** can see the bigger picture and
  decide who is responsible. The agent itself never decides that.

How the journey is meant to work:

1. A person submits their story (and a document, if they have one).
2. The agent structures it: company, date, amount, category, what is missing.
3. The agent searches for duplicates and for **similar claims from other people**.
4. Similar claims are grouped into a case with a summary for the legal team.
5. Participants join the case, the legal team reviews every claim and decides what to do next (human-in-the-loop).

What this demo implements today, and what is intentionally left as the next step:

| Part of the idea | Status in this demo |
|------------------|---------------------|
| Submit a story, structure it, ask for missing data | Implemented |
| Detect duplicates and similar claims of other people | Implemented (word-overlap similarity; embeddings are a next step) |
| Group claims into a case with a summary for the legal team | Implemented |
| Legal team reviews, approves or rejects each claim | Implemented |
| Tell a participant "N other people reported the same problem" and let them **join the case** | Implemented: after submitting, the participant sees how many *other* people reported a similar problem, how many already joined, and the period; they can join (explicit consent required) or withdraw. The legal team sees who joined |
| Connect people without exposing personal data | Partly: participants only see anonymous counts and dates, never names, e-mails or texts of others. Direct contact between participants is not implemented; the legal team reaches out to those who joined |
| Find one incident behind claims against **different** companies (shared carrier, sender location, dates, e.g. the Brovary warehouses) | Not implemented. The facts are extracted and shown, but cases are grouped only by company + category |

## 1. Problem statement

When a company harms many people in a similar way (a damaged or misdescribed product, double billing, a data leak), a law firm or
consumer-rights group has to collect hundreds of unstructured complaints before deciding whether a collective action
makes sense. Today this is manual: reading every message, retyping facts into a spreadsheet, spotting people who
wrote twice, and guessing who is complaining about the same thing.

## 2. What the agent does

For every submitted complaint the agent runs a multi-step workflow:

1. **Guardrails** – flags prompt-injection-like content.
2. **Document Analyzer** – extracts company, incident date, amount, product, key facts from the text + attached document.
3. **Claim Classifier** – assigns one of 7 categories (`BILLING_OVERCHARGE`, `PRODUCT_DEFECT`, `DATA_PRIVACY`, …).
4. **Completeness check** – required: company, incident date, amount *or* a supporting document. Missing items produce follow-up questions.
5. **Case Registry (participant)** – registers/finds the participant by e-mail.
6. **Duplicate Detector** – same person + same company + same text/incident → duplicate; other people with similar text → "similar claims".
7. **Case Registry (claim)** – stores the claim and groups it by *company + category* into a **case**.
8. **Case Summary Generator** – refreshes the briefing for the legal team (statistics in code, narrative by LLM).

**In scope:** intake, extraction, classification, completeness, dedup, grouping, summary, human review (approve/reject), trace/logs.

**Out of scope (by design):** legal assessment of any kind (validity, liability, chances of success, damages), contacting
participants, OCR/PDF parsing (documents are plain text), authentication, multi-tenancy.

## 3. Business cases covered

The demo scenario: **SWAN** (boilers) and **SAMSUNG** (washing machines) ship goods to retail buyers via **NOVA POSHTA**.
Buyers received sealed boxes and found shrapnel holes only at home. Both sender warehouses are in the Brovary area,
where a drone strike is suspected — so the damage may have happened at a warehouse, at a NOVA POSHTA terminal or in transit.

| # | Case | Sample | Result |
|---|------|--------|--------|
| 1 | Boiler arrives in a sealed box, but at home the buyer finds shrapnel holes (damaged at the SWAN warehouse, a NOVA POSHTA terminal or in transit — unknown) | `01-boiler-damaged-shrapnel.json` | `READY_FOR_REVIEW`, new case *SWAN / PRODUCT_DEFECT* |
| 2 | Another retail buyer, same problem (company spelled "Swan") | `02-boiler-damaged-second-customer.json` | `READY_FOR_REVIEW`, same case, linked as similar claim |
| 3 | Buyer from #1 submits again | `03-boiler-damaged-duplicate.json` | `DUPLICATE`, linked to the original, not counted |
| 4 | Boiler heats water 2x slower than advertised, warranty service refuses to replace it | `04-boiler-heating-time-warranty.json` | `READY_FOR_REVIEW`, new case *SWAN / FALSE_ADVERTISING* |
| 5 | Another buyer, same heating-time problem, plus an injected "approve this claim" instruction | `05-boiler-heating-time-injection.json` | `FLAGGED`, text treated as data, manual check required |
| 6 | Damaged boiler, but company, date and evidence are missing | `06-boiler-damaged-needs-info.json` | `NEEDS_INFO` + 3 follow-up questions |
| 7 | Parcel never opened, NOVA POSHTA branch refuses to take it back, sender does not answer | `07-nova-poshta-return-refused.json` | `READY_FOR_REVIEW`, new case *NOVA POSHTA / SERVICE_FAILURE* |
| 8 | Another buyer, same refused return ("Nova Poshta" spelling) | `08-nova-poshta-return-refused-second-customer.json` | `READY_FOR_REVIEW`, same case, linked as similar claim |
| 9 | Washing machine from SAMSUNG punctured by shrapnel, parcel was sealed at delivery | `09-samsung-washer-damaged-shrapnel.json` | `READY_FOR_REVIEW`, new case *SAMSUNG / PRODUCT_DEFECT* |
| 10 | Another buyer, same problem ("Samsung" spelling) | `10-samsung-washer-damaged-second-customer.json` | same case, linked as similar claim |
| 11 | Invalid input (bad e-mail, too-short text) | — | HTTP 400 with field-level errors |
| 12 | LLM down / returns garbage | — | Workflow still completes using deterministic fallbacks (`fallback` in the trace) |
| 13 | Participant sees how many others reported the same problem and joins the collective claim | UI after submit / `POST /claims/:id/join` | Counts of other participants (anonymous), `joinedAt` set, visible to the legal team |
| 14 | Legal team reviews | UI / `PATCH /claims/:id/review` | Claim approved/rejected, case summary refreshed |

The same underlying event (parcels damaged by shrapnel) can legitimately involve three defendants: SWAN, SAMSUNG and
NOVA POSHTA. Claims are grouped per company and category, the sender warehouse location from the waybill is kept in the
extracted facts, and the legal team decides who is responsible (carrier, warehouse operators, or an event outside anyone's
control). The agent never assigns blame.

## 4. Architecture

```
React UI ──HTTP──> NestJS API ──> ClaimsAgent (orchestrator) ──> tools ──> Repository ──> PostgreSQL (Prisma)
                                       │                          │
                                       │                          └─ LlmClient ──> OpenAI (JSON mode) / disabled → heuristics
                                       └─ trace + Pino logs + AgentRun row per claim
```

```
POST /api/claims
  │ Zod input validation (400 on error)
  ▼
 guardrails ─► analyze_document ─► classify_claim ─► check_completeness ─► register_participant
   (regex)       (LLM→Zod|heur.)     (LLM→Zod|heur.)     (deterministic)        (Case Registry)
                                                                                     │
 update_case_summary ◄─ register_claim + assign case ◄─ decide status ◄─ detect_duplicates
  (LLM→Zod|template)      (Case Registry)              (code)            (deterministic)
```

| Tool | Type | File |
|------|------|------|
| Document Analyzer | LLM + deterministic sanity checks + heuristic fallback | `backend/src/agent/tools/document-analyzer.tool.ts` |
| Claim Classifier | LLM (closed enum) + keyword fallback | `…/claim-classifier.tool.ts` |
| Duplicate Detector | Deterministic (Jaccard text similarity + rules) | `…/duplicate-detector.tool.ts` |
| Case Registry | Plain code, the only writer to the DB | `…/case-registry.tool.ts` |
| Case Summary Generator | Stats in code, narrative by LLM, legal-conclusion filter, template fallback | `…/case-summary.tool.ts` |

**Why a custom orchestrator (no LangGraph / Agents SDK).** The process is a known pipeline with a few branches
(duplicate? incomplete? flagged?). An explicit, code-defined plan is easier to test, cheaper (3 LLM calls per claim),
and safer: the model never picks tools or writes data, so there is nothing for an injected instruction to hijack.
A framework would add dependencies and indirection without adding capability for this workflow. If the workflow
became open-ended (e.g. the agent decides to request more documents), a graph framework would then be justified.

**State management.** One `trace: TraceStep[]` per run (step, tool, status, duration, attempts, details), persisted
as an `AgentRun` row together with the outcome. Business state lives in PostgreSQL (`Participant`, `Claim`, `Case`, `AgentRun`).

### Reliability and guardrails

- **Structured output:** every LLM answer must pass a Zod schema (JSON mode). Invalid answers are retried with the validation error fed back (`LLM_MAX_RETRIES`, default 2), API errors with exponential backoff, timeouts via `LLM_TIMEOUT_MS`.
- **Fallbacks:** after retries, each tool switches to a deterministic heuristic and the trace shows `fallback`. Without `OPENAI_API_KEY` the whole system runs this way (offline mode).
- **Deterministic checks on LLM output:** future/implausible dates and absurd amounts are dropped; the company typed by the participant overrides the extracted one; category must be in the enum.
- **Prompt-injection defence (defence in depth):**
  1. detection by pattern (EN/RU/UK) → claim becomes `FLAGGED`, never silently dropped or obeyed;
  2. untrusted text is fenced in `<untrusted_*>` tags (look-alike tags inside are neutralised) and the system prompt declares it data;
  3. **capability limitation:** the LLM has no tools and no DB access; the orchestrator (code) decides every side effect, status and grouping;
  4. output validation by Zod.
- **No legal opinions:** system prompts forbid them, and generated summaries are scanned for legal conclusions ("has a strong case", "is liable", "entitled to compensation"…). On a hit the summary is replaced by a neutral template. Every summary carries a disclaimer and every result has `requiresHumanReview: true`.
- **Privacy:** names and e-mails are not sent to the LLM for summaries (only ids, categories, extracted facts).
- **Observability:** Pino JSON logs for each step (`agent_step`) and the final decision (`agent_decision`), request logs via `nestjs-pino`, full trace in the API response and in the `AgentRun` table.

## 5. Setup

Requirements: Node.js 20+ (developed on 24), Docker (for PostgreSQL).

### Option A — everything in Docker

```bash
cp .env.example .env        # Windows: copy .env.example .env  (optional: put an API key there)
docker compose up --build
```

UI: <http://localhost:8080> · API: <http://localhost:3000/api>. The backend applies Prisma migrations on start.
Without `OPENAI_API_KEY` the agent runs in offline mode.

**Docker troubleshooting (Windows).** `error during connect: ... pipe/dockerDesktopLinuxEngine: The system cannot find the file
specified` means the Docker CLI points at Docker Desktop, but it is not running (or another engine such as Rancher
Desktop is installed). Start Docker Desktop, or switch the CLI to the engine that is running:

```bash
docker context ls                    # the active context is marked with *
docker context use default           # e.g. Rancher Desktop / Docker Engine
```

You can also pass it per command: `docker --context default compose up --build`. If the backend container exits at
start, look at its log: `docker compose logs backend`.

### Option B — local development

```bash
docker compose up -d db                      # PostgreSQL only
cd backend
cp .env.example .env                         # Windows: copy .env.example .env
# in backend/.env change STORAGE=memory to STORAGE=postgres
npm install
npx prisma generate
npx prisma migrate deploy
npm run start:dev                            # http://localhost:3000/api

# second terminal
cd frontend
npm install
npm run dev                                  # http://localhost:5173 (proxies /api)
```

**Quickest start, no database and no API key.** `backend/.env.example` is ready to run as is
(`STORAGE=memory`, offline heuristics); data is kept in process memory and lost on restart:

```bash
cd backend
cp .env.example .env                    # Windows: copy .env.example .env
npm install
npm run start:dev
```

Then in a second terminal: `cd backend && npm run samples`. Without a `.env` file the same works with
`STORAGE=memory npm run start:dev` (bash) or `$env:STORAGE = "memory"; npm run start:dev` (PowerShell).

**Troubleshooting.** The server stops at start with `DATABASE_URL is required when STORAGE=postgres` when neither
`backend/.env` (copied from `backend/.env.example`) nor `STORAGE=memory` is set: the default storage is PostgreSQL. With PostgreSQL
also run `npx prisma migrate deploy` once, otherwise the tables do not exist.

### Configuration

| Variable | Default | Meaning |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | empty | Claude API key; when set, Claude is used |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | e.g. `claude-haiku-5-5` is much cheaper and enough for this task |
| `ANTHROPIC_EFFORT` | unset | `low` \| `medium` \| `high` \| `xhigh` \| `max`; `low` is enough here, leave unset for the model default |
| `LLM_PROVIDER` | auto | `anthropic` \| `openai` \| `none`; auto = Claude if `ANTHROPIC_API_KEY` is set, else OpenAI if `OPENAI_API_KEY` is set, else offline |
| `OPENAI_API_KEY` | empty | OpenAI or OpenAI-compatible provider (see below) |
| `OPENAI_MODEL` | `gpt-4o-mini` | any chat model that supports JSON mode |
| `OPENAI_BASE_URL` | empty (api.openai.com) | any OpenAI-compatible endpoint (Gemini, Groq, OpenRouter, Ollama…) |
| `LLM_TIMEOUT_MS` / `LLM_MAX_RETRIES` | `20000` / `2` | per-call timeout / extra attempts |
| `DUPLICATE_SIMILARITY_THRESHOLD` | `0.6` | Jaccard threshold for duplicates |
| `STORAGE` | `postgres` | `postgres` or `memory` |

### Using a real LLM

Two providers are supported; with no key at all the agent runs offline on heuristics. On start the log shows
`llm=<model> @ <endpoint>`; in the API response the trace shows `ok` instead of `fallback` for the LLM steps.

**Claude (Anthropic API)** — official `@anthropic-ai/sdk`, `backend/src/llm/anthropic-llm.client.ts`:

```
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-haiku-5-5
ANTHROPIC_EFFORT=low
```

The key comes from the [Claude Console](https://console.anthropic.com/) and is billed per token, separately from a
claude.ai subscription. The default model is `claude-opus-5-5`; `claude-haiku-5-5` costs a fraction of it and is
plenty for extraction, classification and short summaries. For Opus/Fable/Sonnet 5.5 the client opts into
server-side `fallbacks: "default"`; if the model still declines a request (`stop_reason: refusal`), it is not retried and the tool
falls back to its deterministic heuristic. If you are logged in with `ant auth login`, `LLM_PROVIDER=anthropic`
works without a key in the environment.

**OpenAI or any OpenAI-compatible provider** (`OPENAI_API_KEY`, optional `OPENAI_BASE_URL` / `OPENAI_MODEL`). The
client uses the Chat Completions API in JSON mode, so any provider works if its model supports
`response_format: json_object`. Free tiers, limits and model names change often — check the provider's page.

| Provider | `OPENAI_BASE_URL` | Example `OPENAI_MODEL` | Notes |
|----------|-------------------|------------------------|-------|
| OpenAI | empty | `gpt-4o-mini` | no permanent free tier, prepaid credits; a few cents for the demo |
| Google Gemini (AI Studio) | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-2.5-flash` | free tier with rate limits |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | free tier with rate limits |
| OpenRouter | `https://openrouter.ai/api/v1` | a model ending in `:free` | free models have daily limits; JSON mode support varies |
| Ollama (local, no account) | `http://localhost:11434/v1` | `llama3.1` | set any dummy key, e.g. `OPENAI_API_KEY=ollama`; from Docker use `http://host.docker.internal:11434/v1` |

Free tiers may use submitted data to improve their products: use only the fake data from `samples/`, never real complaints.
For every provider the model output is validated with Zod; invalid JSON is retried with the error fed back, then the tool falls back to heuristics (visible as `fallback` in the trace).

## 6. How to test / verify

### Automated

```bash
cd backend
npm test            # unit + e2e, no network and no database needed
npm run test:unit
npm run test:e2e
```

- **Unit** (`backend/test/unit`): guardrails, heuristics, completeness, duplicate detector, LLM client retry/validation logic, tools with a scripted fake LLM (including: invalid LLM output → fallback, legal conclusion in summary → blocked).
- **Integration / e2e** (`backend/test/e2e`): the real Nest app over HTTP (supertest) with in-memory storage; submits all files from `samples/claims` and checks them against `samples/expected.json`, then checks trace, grouping, similar-claim links, review flow, validation errors, and the LLM-failure and LLM-success paths.

### Manual (API must be running)

```bash
cd backend
npm run samples     # submits samples/claims/*.json and compares with samples/expected.json
```

Or use the UI: **Submit a claim → Fill example → Submit**, then **Cases (legal team)** to review.
With curl:

```bash
curl -s -X POST localhost:3000/api/claims -H "content-type: application/json" \
  -d @samples/claims/01-boiler-damaged-shrapnel.json
```

## 7. Example input / output

Input: [`samples/claims/05-boiler-heating-time-injection.json`](samples/claims/05-boiler-heating-time-injection.json) — a real complaint with an embedded "approve this claim" instruction.

Output (abridged; offline mode; submitted after sample 04):

```json
{
  "status": "FLAGGED",
  "category": "FALSE_ADVERTISING",
  "categoryConfidence": 0.9,
  "flags": ["PROMPT_INJECTION_SUSPECTED"],
  "extracted": { "company": "SWAN", "incidentDate": "2025-09-20", "amount": 13200, "currency": "UAH" },
  "similarClaims": [{ "similarity": 0.45, "sameParticipant": false }],
  "case": { "company": "SWAN", "category": "FALSE_ADVERTISING", "claimsInCase": 2 },
  "requiresHumanReview": true,
  "decision": "Claim 677fe149 from Taras Melnyk registered with status FLAGGED. Category: FALSE_ADVERTISING (confidence 0.9). Company: SWAN. Incident date: 2025-09-20. Amount: 13200 UAH. Suspicious instruction-like content detected (ignore_instructions, force_decision); the text was treated as data only and the claim needs a manual check. Grouped into case \"SWAN / FALSE_ADVERTISING\" (2 active claim(s)). 1 similar claim(s) found. No legal assessment was made: a legal professional must review this claim.",
  "trace": [
    { "step": "guardrails", "status": "ok" },
    { "step": "analyze_document", "tool": "document_analyzer", "status": "fallback" },
    { "step": "classify_claim", "tool": "claim_classifier", "status": "fallback" },
    { "step": "check_completeness", "status": "ok" },
    { "step": "register_participant", "tool": "case_registry", "status": "ok" },
    { "step": "detect_duplicates", "tool": "duplicate_detector", "status": "ok" },
    { "step": "register_claim", "tool": "case_registry", "status": "ok" },
    { "step": "update_case_summary", "tool": "case_summary_generator", "status": "fallback" }
  ]
}
```

`fallback` here only means "no LLM key configured"; with a key the same steps show `ok` and the model's validated output.

Result of `npm run samples` (offline; the script also prints the full `decision` text and trace per sample):

```
✓ 01-boiler-damaged-shrapnel.json
✓ 02-boiler-damaged-second-customer.json
✓ 03-boiler-damaged-duplicate.json
✓ 04-boiler-heating-time-warranty.json
✓ 05-boiler-heating-time-injection.json
✓ 06-boiler-damaged-needs-info.json
✓ 07-nova-poshta-return-refused.json
✓ 08-nova-poshta-return-refused-second-customer.json
✓ 09-samsung-washer-damaged-shrapnel.json
✓ 10-samsung-washer-damaged-second-customer.json
All samples match expected output
```

Resulting cases: *SWAN / PRODUCT_DEFECT* (2 claims, 24 200 UAH reported), *SAMSUNG / PRODUCT_DEFECT* (2 claims),
*SWAN / FALSE_ADVERTISING* (2 claims, 1 flagged), *NOVA POSHTA / SERVICE_FAILURE* (2 claims).

### API

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/claims` | submit a claim, run the agent, get structured result + trace |
| GET | `/api/claims`, `/api/claims/:id` | list / details with participant and agent runs |
| GET | `/api/claims/:id/similar` | participant view: how many *other* people reported a similar problem (anonymous counts + incident period) |
| POST | `/api/claims/:id/join` | `{consent: true}` — join the collective claim; idempotent |
| DELETE | `/api/claims/:id/join` | withdraw from the collective claim |
| PATCH | `/api/claims/:id/review` | `{decision: APPROVED|REJECTED, note?}` — human decision |
| GET | `/api/cases`, `/api/cases/:id` | cases and their claims + summary |
| POST | `/api/cases/:id/summary` | regenerate the summary |

## 8. Trade-offs, limitations, next steps

- **No authentication for participants.** The claim id (a random UUID returned on submit) acts as a secret link for `GET /similar` and `POST/DELETE /join`. Next: e-mail verification / magic links before exposing the participant view, and rate limiting to prevent probing.
- **"Similar" means same company + category** (verified, complete claims only; flagged, duplicate, rejected and incomplete claims are not counted). Participants never see other people's data, only counts. Next: letting participants opt in to be contacted by each other.
- **Cross-case incident linking.** Next: link cases of different companies through shared facts (carrier, sender location, date window) so that one event behind several claims becomes visible to the legal team.
- **Duplicate detection is lexical** (Jaccard on words), so paraphrases are missed. Next: embeddings (pgvector) + the LLM as a tie-breaker, still with a human confirming.
- **Duplicate candidates are loaded in memory** (`listClaims`). Fine for hundreds of claims; production needs an indexed query by company key.
- **Company matching** is normalisation only (case, punctuation, legal suffixes). "SWAN" vs "SWAN Ukraine" would be separate cases. Next: alias table / fuzzy match with human merge.
- **Documents are plain text.** Next: PDF/image upload with OCR, file storage, virus scan.
- **Heuristic fallback is intentionally basic** (English keywords); it exists to keep the pipeline alive, not to match LLM quality.
- **Injection detection is pattern-based** and can be evaded; the real protection is architectural (the LLM cannot act). Next: a classifier-based detector and red-team tests.
- **Summary is regenerated on each claim** (1 LLM call). Next: debounce/queue and run async.
- **No auth.** The legal-team views and review endpoints are open; they must be protected before any real use.
- **The Prisma repository has no automated tests** (they use the in-memory implementation of the same interface); it was verified manually against PostgreSQL 16 via Docker Compose by running `npm run samples`. Next: integration tests against a PostgreSQL container.
- Cost/latency: 3 LLM calls per accepted claim with `gpt-4o-mini`-class models.

## 9. Real-world usage

**Not in production today.** This is a demonstration project.

Realistic users:

1. **Consumer-rights organisations / class-action law firms** — intake of thousands of complaints after a mass incident (defective batch, delivery failures, product recall).
2. **Legal-tech or claims-aggregation platforms** — pre-qualification and grouping of claimants before lawyers are engaged.
3. **In-house compliance / customer-complaints teams** at telecoms, banks or retailers — detecting clusters of similar complaints early (systemic issue detection).

To productionise: authentication and role-based access (participants vs. legal team); encryption and retention policy for personal data, GDPR basis and a DPA with the LLM provider (or a self-hosted model); audit log of every human decision; PII redaction before LLM calls; rate limiting and abuse protection on the public intake form; async processing queue with retries; monitoring and alerting (LLM error rate, fallback rate, latency, cost) with OpenTelemetry traces; evaluation set to track classification/extraction quality; compliance review of the disclaimer wording with the legal team; keep the human-in-the-loop gate for every legal decision.

## Repository layout

```
backend/    NestJS API: src/agent (orchestrator, tools, guardrails), src/llm, src/storage, prisma/, test/
frontend/   React UI (submit claim, cases + review)
samples/    sample claims and expected results
docker-compose.yml
```
