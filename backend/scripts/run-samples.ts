import * as fs from 'fs';
import * as path from 'path';

const API = process.env.API_URL ?? 'http://localhost:3000/api';
const dir = path.resolve(__dirname, '../../samples');
const expected: Record<string, any> = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));

async function main() {
  let failed = 0;
  const ids: Record<string, string> = {};
  for (const file of Object.keys(expected)) {
    const input = JSON.parse(fs.readFileSync(path.join(dir, 'claims', file), 'utf8'));
    const res = await fetch(`${API}/claims`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    const body: any = await res.json();
    if (!res.ok) {
      console.log(`✗ ${file}: HTTP ${res.status} ${JSON.stringify(body)}`);
      failed++;
      continue;
    }
    ids[file] = body.claimId;
    const want = expected[file];
    const problems: string[] = [];
    if (body.status !== want.status) problems.push(`status ${body.status} != ${want.status}`);
    if (body.category !== want.category) problems.push(`category ${body.category} != ${want.category}`);
    if (want.missingFields && JSON.stringify(body.missingFields) !== JSON.stringify(want.missingFields)) problems.push(`missing ${body.missingFields}`);
    console.log(`${problems.length ? '✗' : '✓'} ${file}\n    ${body.decision}`);
    console.log(`    trace: ${body.trace.map((s: any) => `${s.step}:${s.status}`).join(' > ')}`);
    if (problems.length) {
      console.log(`    PROBLEMS: ${problems.join('; ')}`);
      failed++;
    }
  }
  console.log(failed ? `\n${failed} sample(s) differ from expected output` : '\nAll samples match expected output');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('Could not reach the API:', e.message);
  process.exit(1);
});
