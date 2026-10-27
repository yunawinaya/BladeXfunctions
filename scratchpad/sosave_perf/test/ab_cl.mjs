// A/B on DEV: CREDIT_LIMIT_CHECK as published (run endpoint) against the build (doTest of out/CREDIT_LIMIT_CHECK.json,
// dryRun) for the same requests; every answer must match. CREDIT_LIMIT_CHECK writes nothing. CLI session (tenant 000000) + audit.
//
//   node scratchpad/sosave_perf/test/ab_cl.mjs <cases.json> <out.json>      cases.json: [{customer_id, total, document_type}, ...]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLI = '/Users/yunawinaya/.nvm/versions/node/v22.16.0/lib/node_modules/sudu-lowcode-cli/src';
const { roots } = await import(`${CLI}/paths.mjs`);
const { resolveProfile } = await import(`${CLI}/profiles.mjs`);
const { ensureFresh } = await import(`${CLI}/auth/session.mjs`);
const { appendAudit } = await import(`${CLI}/audit.mjs`);

const WF = '1990247316342333442';
const [casesFile, outFile] = process.argv.slice(2);
if (!casesFile || !outFile) {
  console.error('usage: node ab_cl.mjs <cases.json> <out.json>');
  process.exit(2);
}
const r = roots();
const profile = resolveProfile(r, 'dev-main-write');
if (!/^https:\/\/([a-z0-9-]+\.)?dev\.mes\.sudu\.ai\/api$/.test(profile.endpoint.replace(/\/+$/, ''))) throw new Error(`profile ${profile.name} is not a dev endpoint`);
const session = await ensureFresh(r, profile.name, { fetchImpl: fetch });
const BASE = 'https://dev.mes.sudu.ai/api';
const scriptJson = JSON.stringify(JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'out', 'CREDIT_LIMIT_CHECK.json'), 'utf8')));

const post = async (p, body) => {
  const t = Date.now();
  const res = await fetch(BASE + p, { method: 'POST', headers: { 'Blade-Auth': `bearer ${session.accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  let j = null;
  try { j = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, ms: Date.now() - t, j, text };
};
// the workflow's answer from either endpoint: {message, result, credit_limit, current_credit_amount, over_credit_amount}
const answerOfRun = (j) => (j && j.data && typeof j.data === 'object' ? j.data : null);
const answerOfTest = (j) => {
  const d = j && j.data && typeof j.data === 'object' ? (j.data.data && typeof j.data.data === 'object' ? j.data.data : j.data) : {};
  let a = d.responseJsonData;
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch { /* keep */ } }
  if (a && typeof a === 'object' && a.data && typeof a.data === 'object' && !('result' in a)) a = a.data;
  return { answer: a && typeof a === 'object' ? a : null, status: d.status, error: d.errorMsg || d.runErrorMsg || null };
};
const canon = (o) => JSON.stringify(o, Object.keys(o || {}).sort());

const cases = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
const results = [];
let same = 0;
for (const c of cases) {
  const live = await post(`/su-code-workflow/workflow/run/${WF}`, c);
  const test = await post(`/su-code-workflow/workflow/doTest/${WF}`, { scriptJson, request: c, dryRun: true });
  const a = answerOfRun(live.j);
  const b = answerOfTest(test.j);
  // c.expect: "same" (default); "not_found" (the build answers Customer Not Found); "fraction" (the build adds the
  // fraction of `total` that the published int param drops, all else equal)
  const frac = Number(c.total) - Math.trunc(Number(c.total));
  const ok = !!a && !!b.answer && (
    c.expect === "not_found" ? b.answer.message === "Customer Not Found" && b.answer.result === "failed"
      : c.expect === "fraction" ? Math.abs(Number(b.answer.current_credit_amount) - Number(a.current_credit_amount) - frac) < 1e-9 && b.answer.credit_limit === a.credit_limit
      : canon(a) === canon(b.answer));
  if (ok) same++;
  results.push({ case: c, ok, live: { status: live.status, ms: live.ms, answer: a, raw: a ? undefined : live.text.slice(0, 400) }, test: { status: test.status, ms: test.ms, run: b.status, answer: b.answer, error: b.error } });
  console.log(`${ok ? 'same' : 'DIFF'}  ${String(c.customer_id).padEnd(20)} ${String(c.document_type).padEnd(15)} total ${String(c.total).padEnd(6)}  v15 ${a ? a.result : '?'} ${live.ms} ms | new ${b.answer ? b.answer.result : '?'} ${test.ms} ms${ok ? '' : `\n   v15: ${JSON.stringify(a)}\n   new: ${JSON.stringify(b.answer)} ${b.error ? 'error ' + JSON.stringify(b.error).slice(0, 300) : ''}`}`);
}
fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
appendAudit(r, { osUser: os.userInfo().username, profile: profile.name, endpoint: profile.endpoint, args: ['ab_cl', WF, String(cases.length)], class: 'write',
  account: session.account ?? null, client: session.clientId ?? null, result: `same:${same}/${cases.length}`, durationMs: 0 });
console.log(`${same} of ${cases.length} answers identical`);
process.exit(same === cases.length ? 0 : 1);
