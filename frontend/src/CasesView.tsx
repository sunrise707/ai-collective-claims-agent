import { useCallback, useEffect, useState } from 'react';
import { api, CaseDetail, CaseListItem } from './api';
import { Badge } from './SubmitView';

export function CasesView() {
  const [cases, setCases] = useState<CaseListItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const loadCases = useCallback(() => run(async () => setCases(await api.listCases())), [run]);
  const loadDetail = useCallback((id: string) => run(async () => setDetail(await api.getCase(id))), [run]);

  useEffect(() => { loadCases(); }, [loadCases]);
  useEffect(() => { if (selected) loadDetail(selected); }, [selected, loadDetail]);

  const review = (claimId: string, decision: 'APPROVED' | 'REJECTED') =>
    run(async () => {
      const note = decision === 'REJECTED' ? (window.prompt('Reason for rejection (optional)') ?? undefined) : undefined;
      await api.review(claimId, decision, note || undefined);
      await loadDetail(selected!);
      await loadCases();
    });

  const summary = detail?.case.summary;

  return (
    <div className="grid">
      <div className="card">
        <h2>Cases</h2>
        <button className="secondary" onClick={loadCases}>Refresh</button>
        {cases.length === 0 && <p className="muted">No cases yet. Submit a claim first.</p>}
        <ul className="list">
          {cases.map((c) => (
            <li key={c.id}>
              <button className={`link ${selected === c.id ? 'active' : ''}`} onClick={() => setSelected(c.id)}>
                <strong>{c.company}</strong> · {c.category.replace(/_/g, ' ')} · {c.claimCount} claim(s)
              </button>
            </li>
          ))}
        </ul>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="card">
        {!detail && <p className="muted">Select a case to see the summary prepared for the legal team.</p>}
        {detail && (
          <>
            <h2>{detail.case.company} / {detail.case.category}</h2>
            {summary ? (
              <>
                <h3>{summary.headline} <Badge value={summary.source} /></h3>
                <p>{summary.overview}</p>
                <p className="stats">
                  {summary.stats.totalClaims} active · {summary.stats.readyForReview} ready · {summary.stats.needsInfo} need info ·{' '}
                  {summary.stats.flagged} flagged · {summary.stats.duplicatesExcluded} duplicates excluded
                  {Object.keys(summary.stats.totalAmountByCurrency).length > 0 &&
                    ` · total ${Object.entries(summary.stats.totalAmountByCurrency).map(([c, v]) => `${v} ${c}`).join(', ')}`}
                </p>
                {summary.commonPatterns.length > 0 && <ul>{summary.commonPatterns.map((p) => <li key={p}>{p}</li>)}</ul>}
                {summary.openIssues.length > 0 && (
                  <>
                    <strong>Open issues</strong>
                    <ul>{summary.openIssues.map((p) => <li key={p}>{p}</li>)}</ul>
                  </>
                )}
                <p className="disclaimer">{summary.disclaimer}</p>
              </>
            ) : (
              <p className="muted">No summary yet.</p>
            )}
            <button className="secondary" onClick={() => run(async () => { await api.regenerateSummary(detail.case.id); await loadDetail(detail.case.id); })}>
              Regenerate summary
            </button>

            <h3>Claims ({detail.claims.filter((c) => c.joinedAt).length} of {detail.claims.length} joined)</h3>
            <table>
              <thead><tr><th>Participant</th><th>Status</th><th>Date</th><th>Amount</th><th>Review</th><th /></tr></thead>
              <tbody>
                {detail.claims.map((c) => (
                  <tr key={c.id} className={c.reviewStatus === 'REJECTED' || c.status === 'DUPLICATE' ? 'dim' : ''}>
                    <td title={c.description}>{c.participant?.name}<br /><span className="muted">{c.participant?.email}</span></td>
                    <td><Badge value={c.status} />{c.flags.map((f) => <Badge key={f} value={f} />)}</td>
                    <td>{c.extracted.incidentDate ?? '—'}</td>
                    <td>{c.extracted.amount !== null ? `${c.extracted.amount} ${c.extracted.currency ?? ''}` : '—'}</td>
                    <td><Badge value={c.reviewStatus} />{c.joinedAt && <Badge value="JOINED" />}</td>
                    <td className="actions">
                      <button onClick={() => review(c.id, 'APPROVED')}>Approve</button>
                      <button className="danger" onClick={() => review(c.id, 'REJECTED')}>Reject</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
