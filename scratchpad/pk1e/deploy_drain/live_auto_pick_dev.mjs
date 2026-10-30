// live_auto_pick_dev.mjs: DEV only, writes. The Picking list's Auto Pick & Complete as the list runs it (Picking/AsyncV2/
// pkV2_listAutoPick.js, every timer as published): per Picking, PICKING_ASYNC_SUBMIT PICK_ALL_REMAINING, the list's own
// followGdCompletes (STATUS every 3 s, each queued completion handed to the browser's GD Complete drain) and the Picking worker
// started without waiting for its answer. Then the drain runs GD_COMPLETE_WORKER {} one at a time until every delivery handed
// over has ended. Calls go to the dev run API as the CLI user (tenant 000000).
//   node scratchpad/pk1e/deploy_drain/live_auto_pick_dev.mjs <out.json>
import fs from 'node:fs';
import os from 'node:os';

const CLI = '/Users/yunawinaya/.nvm/versions/node/v22.16.0/lib/node_modules/sudu-lowcode-cli/src';
const { roots } = await import(`${CLI}/paths.mjs`);
const { resolveProfile } = await import(`${CLI}/profiles.mjs`);
const { ensureFresh } = await import(`${CLI}/auth/session.mjs`);
const { appendAudit } = await import(`${CLI}/audit.mjs`);

const OUT = process.argv[2];
if (!OUT) { console.error('usage: node live_auto_pick_dev.mjs <out.json>'); process.exit(2); }
const r = roots();
const profile = resolveProfile(r, 'dev-main-write');
if (!/^https:\/\/([a-z0-9-]+\.)?dev\.mes\.sudu\.ai\/api$/.test(profile.endpoint.replace(/\/+$/, ''))) throw new Error(`profile ${profile.name} is not a dev endpoint`);
const session = await ensureFresh(r, profile.name, { fetchImpl: fetch });
const BASE = 'https://dev.mes.sudu.ai/api';

const ORG = '1123598813738675201';
const PICKINGS = ['2102957916317728769', '2101936667502252033', '2101860268342972417', '2095065736511291394', '2090654366282080258',
  '2090652021833916418', '2089190420788547585', '2067796350815109121'];
const NAMES = { '2109531449614647297': 'PICKING_ASYNC_SUBMIT', '2109531412499251201': 'PICKING_ASYNC_WORKER', '2110182609618337794': 'GD_COMPLETE_SUBMIT', '2110182645714518018': 'GD_COMPLETE_WORKER' };

const t0 = Date.now();
const T = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
const log = [];
const note = (...a) => { const line = [T(), ...a].join(' '); log.push(line); console.log(line); };

const post = async (id, params) => {
  const started = Date.now();
  const res = await fetch(BASE + `/su-code-workflow/workflow/run/${id}`, {
    method: 'POST',
    headers: { 'Blade-Auth': `bearer ${session.accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  appendAudit(r, { osUser: os.userInfo().username, profile: profile.name, endpoint: profile.endpoint, args: ['live_auto_pick_dev', id], class: 'write',
    account: session.account ?? null, client: session.clientId ?? null, result: `http:${res.status}`, durationMs: Date.now() - started });
  let body = null;
  try { body = JSON.parse(text); } catch (e) { body = { raw: text.slice(0, 300) }; }
  return { status: res.status, body, ms: Date.now() - started };
};

let inFlight = 0, maxInFlight = 0;
const ctx = {
  getVarGlobal: () => 'admin',
  refresh: () => {}, hide: () => {},
  $message: { success: (m) => note('MSG ok:', m), warning: (m) => note('MSG warn:', m), error: (m) => note('MSG err:', m) },
  runWorkflow: (id, params, ok, err) => {
    const name = NAMES[id] || id;
    const gdcRun = name === 'GD_COMPLETE_WORKER';
    if (gdcRun) { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); note('start', name, JSON.stringify(params), 'in flight', inFlight); }
    post(id, params).then(({ status, body, ms }) => {
      if (gdcRun) inFlight--;
      const d = body && body.data;
      const brief = name === 'GD_COMPLETE_WORKER' ? `${d ? `${d.worker_route} processed ${d.processed} ${d.job_status || ''} ${d.result_code || ''}` : JSON.stringify(body).slice(0, 160)}`
        : name === 'GD_COMPLETE_SUBMIT' ? `${params.gd_id} -> ${d ? d.job_status : JSON.stringify(body).slice(0, 120)}`
        : name === 'PICKING_ASYNC_SUBMIT' ? `${params.operation} ${params.picking_id} -> ${d ? `${d.route || ''} ${d.result_code || ''} ${d.job_status || ''} ${d.job_id || ''} ${String(d.result_message || '').slice(0, 80)} gd_complete=${typeof d.gd_complete === 'string' ? d.gd_complete.slice(0, 160) : JSON.stringify(d.gd_complete || '').slice(0, 160)}` : JSON.stringify(body).slice(0, 160)}`
        : `${params.job_id || ''} -> ${d ? `${d.worker_route || d.route || ''} ${d.job_status || ''}` : JSON.stringify(body).slice(0, 120)}`;
      note(`${name} (${ms} ms)`, brief);
      if (status === 200 && body && body.success !== false) ok && ok(body); else (err || (() => {}))(body);
    }).catch((e) => { if (gdcRun) inFlight--; note(name, 'FETCH ERROR', e.message); (err || (() => {}))(e); });
  },
};
const win = {};
const store = { m: {}, getItem: (k) => (k in store.m ? store.m[k] : null), setItem: (k, v) => { store.m[k] = String(v); } };

const SRC = fs.readFileSync('/Users/yunawinaya/Developer/BladeXfunctions/Picking/AsyncV2/pkV2_listAutoPick.js', 'utf8');
if (!SRC.includes('const PK_V2_DRAIN_NEXT_MS = 1000;')) throw new Error('not the drain handler');
const start = SRC.indexOf('const PK_V2_WF = {');
const end = SRC.indexOf('\n};\n', SRC.indexOf('const followGdCompletes = async')) + 4;
const block = SRC.slice(start, end);
const api = new Function('console', 'localStorage', 'window', block + '\nreturn { followGdCompletes, pkV2Call, PK_V2_WF };').call(ctx, { log: () => {}, error: (...a) => note('console.error', ...a.map(String)) }, store, win);

const follows = [];
for (const id of PICKINGS) {
  const key = 'PKA-' + id + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const params = { picking_id: id, organization_id: ORG, operation: 'PICK_ALL_REMAINING', idempotency_key: key, payload: '{}', confirmed_by: 'admin' };
  let sub = await api.pkV2Call(api.PK_V2_WF.SUBMIT, params);
  if (!sub.ok) sub = await api.pkV2Call(api.PK_V2_WF.SUBMIT, params);
  if (!sub.ok) { note('SUBMIT did not complete for', id, sub.error); continue; }
  if (sub.data.route === 'NOT_ELIGIBLE' || String(sub.data.result_code) !== '200' || !sub.data.job_id) { note('not queued:', id, sub.data.route, sub.data.result_code, String(sub.data.result_message || '').slice(0, 120)); continue; }
  follows.push(api.followGdCompletes(id, ORG));
  ctx.runWorkflow(api.PK_V2_WF.WORKER, { job_id: String(sub.data.job_id) }, () => {}, (e) => note('Picking worker start failed', JSON.stringify(e).slice(0, 120)));
}
note('submitted; following', follows.length, 'Pickings');
await Promise.all(follows);
note('follows ended; drain active:', !!(win.pkV2GdcDrain && win.pkV2GdcDrain.active), 'open:', win.pkV2GdcDrain ? Object.keys(win.pkV2GdcDrain.open).join(',') : '-');
const deadline = Date.now() + 10 * 60 * 1000;
while (win.pkV2GdcDrain && win.pkV2GdcDrain.active && Date.now() < deadline) await new Promise((res) => setTimeout(res, 1000));
note('drain ended:', !(win.pkV2GdcDrain && win.pkV2GdcDrain.active), 'max GD_COMPLETE_WORKER runs in flight:', maxInFlight);
fs.writeFileSync(OUT, JSON.stringify({ t0, log, maxInFlight }, null, 1));
process.exit(0);
