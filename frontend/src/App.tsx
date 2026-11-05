import { useState } from 'react';
import { CasesView } from './CasesView';
import { SubmitView } from './SubmitView';

export function App() {
  const [tab, setTab] = useState<'submit' | 'cases'>('submit');
  return (
    <div className="app">
      <header>
        <h1>Collective Claims Agent</h1>
        <p className="muted">
          Collects and organises complaints for a potential collective action. The agent prepares material only — a legal professional decides
          whether any claim is legally valid.
        </p>
        <nav>
          <button className={tab === 'submit' ? 'active' : ''} onClick={() => setTab('submit')}>
            Submit a claim
          </button>
          <button className={tab === 'cases' ? 'active' : ''} onClick={() => setTab('cases')}>
            Cases (legal team)
          </button>
        </nav>
      </header>
      <main>{tab === 'submit' ? <SubmitView /> : <CasesView />}</main>
    </div>
  );
}
