import { FormEvent, useEffect, useState } from 'react';
import { AgentResult, api, ClaimInput, SimilarReports } from './api';

const EXAMPLE: ClaimInput = {
  participantName: 'Olena Bondarenko',
  email: 'olena.bondarenko@example.com',
  company: 'SWAN',
  description:
    'I bought a SWAN boiler for 11900 UAH from the SWAN store in Kyiv. NOVA POSHTA delivered it to my local branch on 2025-10-14 in a fully sealed box, so I did not open it at the branch. At home I found several small holes in the box and in the boiler tank that look like shrapnel damage from a missile strike. The boiler is damaged and unsafe to use.',
  documentText:
    'NOVA POSHTA express waybill 20450123456789\nSender: SWAN, Kyiv\nDelivered: 2025-10-14\nDeclared value: 11900 UAH\nParcel condition at delivery: sealed, no visible damage',
};

export function Badge({ value }: { value: string }) {
  return <span className={`badge ${value}`}>{value.replace(/_/g, ' ')}</span>;
}

export function SubmitView() {
  const [form, setForm] = useState<ClaimInput>({ participantName: '', email: '', company: '', description: '', documentText: '' });
  const [result, setResult] = useState<AgentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof ClaimInput) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.submitClaim({ ...form, company: form.company || undefined, documentText: form.documentText || undefined }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function loadFile(file?: File) {
    if (file) setForm({ ...form, documentText: await file.text() });
  }

  return (
    <div className="grid">
      <form onSubmit={submit} className="card">
        <h2>New claim</h2>
        <label>Name<input value={form.participantName} onChange={set('participantName')} required /></label>
        <label>E-mail<input type="email" value={form.email} onChange={set('email')} required /></label>
        <label>Company (optional — the agent can extract it)<input value={form.company ?? ''} onChange={set('company')} /></label>
        <label>What happened?<textarea rows={5} value={form.description} onChange={set('description')} required minLength={20} /></label>
        <label>Attached document text (optional)<textarea rows={4} value={form.documentText ?? ''} onChange={set('documentText')} /></label>
        <label>…or load a .txt file<input type="file" accept=".txt,text/plain" onChange={(e) => loadFile(e.target.files?.[0])} /></label>
        <div className="row">
          <button type="submit" disabled={busy}>{busy ? 'Agent is working…' : 'Submit'}</button>
          <button type="button" className="secondary" onClick={() => setForm(EXAMPLE)}>Fill example</button>
        </div>
        {error && <p className="error">{error}</p>}
      </form>

      <div className="card">
        <h2>Agent result</h2>
        {!result && <p className="muted">Submit a claim to see the structured result and the agent trace.</p>}
        {result && <Result r={result} />}
      </div>
    </div>
  );
}

function Result({ r }: { r: AgentResult }) {
  const x = r.extracted;
  return (
    <>
      <p><Badge value={r.status} /> {r.flags.map((f) => <Badge key={f} value={f} />)}</p>
      <p>{r.decision}</p>
      <table>
        <tbody>
          <tr><th>Category</th><td>{r.category} ({r.categoryConfidence})</td></tr>
          <tr><th>Company</th><td>{x.company ?? '—'}</td></tr>
          <tr><th>Incident date</th><td>{x.incidentDate ?? '—'}</td></tr>
          <tr><th>Amount</th><td>{x.amount !== null ? `${x.amount} ${x.currency ?? ''}` : '—'}</td></tr>
          <tr><th>Case</th><td>{r.case ? `${r.case.company} / ${r.case.category}` : 'not grouped'}</td></tr>
        </tbody>
      </table>
      {r.followUpQuestions.length > 0 && (
        <>
          <h3>Follow-up questions</h3>
          <ul>{r.followUpQuestions.map((q) => <li key={q}>{q}</li>)}</ul>
        </>
      )}
      <SimilarReportsCard claimId={r.claimId} />
      <h3>Trace ({r.durationMs} ms)</h3>
      <table>
        <thead><tr><th>Step</th><th>Tool</th><th>Status</th><th>ms</th></tr></thead>
        <tbody>
          {r.trace.map((s) => (
            <tr key={s.step}><td>{s.step}</td><td>{s.tool ?? '—'}</td><td><Badge value={s.status} /></td><td>{s.durationMs}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="muted">“fallback” = LLM unavailable or invalid output, deterministic heuristic was used.</p>
    </>
  );
}

function SimilarReportsCard({ claimId }: { claimId: string }) {
  const [data, setData] = useState<SimilarReports | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setConsent(false);
    api.similarReports(claimId).then(setData).catch((e: Error) => setError(e.message));
  }, [claimId]);

  async function act(fn: () => Promise<SimilarReports>) {
    setBusy(true);
    setError(null);
    try {
      setData(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return null;

  if (!data.eligible) {
    return (
      <div className="similar">
        <h3>Others with a similar problem</h3>
        <p className="muted">{data.reason}</p>
      </div>
    );
  }

  const { otherParticipants: n, otherParticipantsJoined: joinedOthers } = data;
  const period = data.period.from && data.period.to ? (data.period.from === data.period.to ? ` on ${data.period.from}` : ` between ${data.period.from} and ${data.period.to}`) : '';

  return (
    <div className="similar">
      <h3>Others with a similar problem</h3>
      {n === 0 ? (
        <p>
          You are the first to report this problem with <strong>{data.case?.company}</strong>. Others who report the same problem will be grouped together with you.
        </p>
      ) : (
        <p>
          <strong>{n}</strong> other {n === 1 ? 'person has' : 'people have'} reported a similar problem ({data.case?.category.replace(/_/g, ' ').toLowerCase()}) with{' '}
          <strong>{data.case?.company}</strong>
          {period}. {joinedOthers} of them {joinedOthers === 1 ? 'has' : 'have'} already joined the collective claim.
        </p>
      )}
      {data.joined ? (
        <>
          <p className="ok">You have joined this collective claim. The legal team can see that you joined.</p>
          <button type="button" className="secondary" disabled={busy} onClick={() => act(() => api.leave(claimId))}>
            Withdraw
          </button>
        </>
      ) : (
        <>
          <label className="check">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            I agree that my claim is included in this collective claim and that the legal team may contact me about it. My personal data is not shown to other participants.
          </label>
          <button type="button" disabled={busy || !consent} onClick={() => act(() => api.join(claimId))}>
            Join the collective claim
          </button>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
