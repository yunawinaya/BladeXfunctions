// A live SO save on DEV the way the SO form drives V2: SO_SAVE_SUBMIT, then SO_SAVE_RUN until the job ends (200 ms between
// calls, 2 s after WAIT), as a real tenant user (token minted by scratchpad/gdc/tools/mint.mjs; never printed). Writes real rows.
//
//   node scratchpad/sosave_perf/test/live_save.mjs <identity.json> <request.json> <out.json>
import fs from 'node:fs';
import { mintToken, DEV_BASE } from '../../gdc/tools/mint.mjs';

const SUBMIT = '2112758477792346114';
const RUN = '2113116286771331073';
const [idFile, reqFile, outFile] = process.argv.slice(2);
if (!idFile || !reqFile || !outFile) {
  console.error('usage: node live_save.mjs <identity.json> <request.json> <out.json>');
  process.exit(2);
}
const call = async (wf, body) => {
  const { token } = mintToken(idFile);
  const t = Date.now();
  const res = await fetch(`${DEV_BASE}/su-code-workflow/workflow/run/${wf}`, {
    method: 'POST', headers: { 'Blade-Auth': `bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const text = await res.text();
  let j = null;
  try { j = JSON.parse(text); } catch { /* not JSON */ }
  return { ms: Date.now() - t, status: res.status, data: j && j.data && typeof j.data === 'object' ? j.data : null, raw: j ? null : text.slice(0, 300) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const log = [];
const t0 = Date.now();
const s = await call(SUBMIT, JSON.parse(fs.readFileSync(reqFile, 'utf8')));
log.push({ wf: 'SUBMIT', ms: s.ms, route: s.data && s.data.route, code: s.data && s.data.code, message: s.data && s.data.message, job_id: s.data && s.data.job_id });
console.log(`SUBMIT ${s.ms} ms -> ${s.data ? `${s.data.route} ${s.data.code} ${s.data.message}` : `HTTP ${s.status} ${s.raw}`}`);
let final = s.data;
if (s.data && s.data.route === 'QUEUED') {
  const jobId = s.data.job_id;
  for (let i = 0; i < 400; i++) {
    const r = await call(RUN, { job_id: jobId });
    const d = r.data || {};
    log.push({ wf: 'RUN', ms: r.ms, route: d.route, job_status: d.job_status, progress: d.progress_message, calls: d.calls });
    console.log(`RUN ${String(r.ms).padStart(6)} ms -> ${d.route} ${d.job_status} (${d.progress_message || ''})${d.calls ? ` worker runs ${d.calls}` : ''}`);
    final = d;
    if (d.route === 'DONE' || d.route === 'STOP' || d.route === 'REJECT' || !r.data) break;
    await sleep(d.route === 'WAIT' ? 2000 : 200);
  }
}
const total = Date.now() - t0;
console.log(`END TO END ${total} ms: ${final ? `${final.route} ${final.job_status || ''} ${final.message || final.progress_message || ''}` : 'no answer'}`);
fs.writeFileSync(outFile, JSON.stringify({ total, log, final }, null, 1));
