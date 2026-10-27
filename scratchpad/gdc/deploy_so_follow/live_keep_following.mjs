// live_keep_following.mjs: the SO list's real Convert handler (repo Goods Delivery/GDhandleConvertSOtoGD.js) run against DEV,
// with this.runWorkflow posting to the run API (as runwf.mjs) - a shared-stock bulk SO -> GD convert, end to end. FOLLOW_MS is
// shortened (FOLLOW_MS_LIVE) so the deliveries the follow leaves are finished by the new background starts; everything else
// is the published code. The page's picking setup read is mocked with the org's setup values (SETUP below).
//   node scratchpad/gdc/deploy_so_follow/live_keep_following.mjs <out.json>
import fs from 'node:fs';
import os from 'node:os';

const CLI = '/Users/yunawinaya/.nvm/versions/node/v22.16.0/lib/node_modules/sudu-lowcode-cli/src';
const { roots } = await import(`${CLI}/paths.mjs`);
const { resolveProfile } = await import(`${CLI}/profiles.mjs`);
const { ensureFresh } = await import(`${CLI}/auth/session.mjs`);
const { appendAudit } = await import(`${CLI}/audit.mjs`);

const OUT = process.argv[2];
if (!OUT) { console.error('usage: node live_keep_following.mjs <out.json>'); process.exit(2); }
const r = roots();
const profile = resolveProfile(r, 'dev-main-write');
if (!/^https:\/\/([a-z0-9-]+\.)?dev\.mes\.sudu\.ai\/api$/.test(profile.endpoint.replace(/\/+$/, ''))) throw new Error(`profile ${profile.name} is not a dev endpoint`);
const session = await ensureFresh(r, profile.name, { fetchImpl: fetch });
const BASE = 'https://dev.mes.sudu.ai/api';

const FOLLOW_MS_LIVE = 20000;
const SETUP = { picking_required: 1, picking_after: 'Goods Delivery', convert_gd_created: 1, auto_completed_gd: 1 };
const PLANT = '1123598813738675202', ORG = '1123598813738675201';
const SOS = ['SO/20260710-021', 'SO/20260706-009', 'SO/20260701-002', 'SO/20260626-104'];

const t0 = Date.now();
const T = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
const log = [];
const note = (...a) => { const line = [T(), ...a].join(' '); log.push(line); console.log(line); };

const run = async (id, params) => {
  const started = Date.now();
  const res = await fetch(BASE + `/su-code-workflow/workflow/run/${id}`, {
    method: 'POST',
    headers: { 'Blade-Auth': `bearer ${session.accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  appendAudit(r, { osUser: os.userInfo().username, profile: profile.name, endpoint: profile.endpoint, args: ['live_keep_following', id], class: 'write',
    account: session.account ?? null, client: session.clientId ?? null, result: `http:${res.status}`, durationMs: Date.now() - started });
  let body = null;
  try { body = JSON.parse(text); } catch (e) { body = { raw: text.slice(0, 300) }; }
  return { status: res.status, body, ms: Date.now() - started };
};

const NAMES = { '2076557490389835777': 'SO_AUTO_GD', '2112084100104495105': 'GD_SO_CONVERT_CHECK', '2104840667119411201': 'GD_ASYNC_WORKER' };
let code = fs.readFileSync('/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/GDhandleConvertSOtoGD.js', 'utf8');
if (!code.includes('const FOLLOW_MS = 120000;')) throw new Error('FOLLOW_MS line not found');
code = code.replace('const FOLLOW_MS = 120000;', `const FOLLOW_MS = ${FOLLOW_MS_LIVE};`);

const alerts = [];
const ctx = {
  showLoading: (t) => note('loading:', t), hideLoading: () => {}, refresh: async () => note('refresh'), getVarGlobal: () => 'admin',
  $alert: async (msg, title) => { alerts.push({ title, msg: String(msg) }); note('ALERT', title, '|', String(msg).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 400)); },
  $confirm: async (msg, title, o) => { note('confirm:', String(title || ''), '->', 'cancel (one GD per SO)'); if (o && o.beforeClose) await o.beforeClose('cancel', {}, () => {}); },
  runWorkflow: (id, params, ok, err) => {
    const name = NAMES[id] || id;
    run(id, params).then(({ status, body, ms }) => {
      const data = body && body.data;
      const brief = name === 'GD_ASYNC_WORKER' ? `job ${params.job_id || '(sweep)'} -> ${data ? `${data.worker_route || ''} ${data.job_status || ''} ${data.result_code || ''}` : JSON.stringify(body).slice(0, 160)}`
        : name === 'GD_SO_CONVERT_CHECK' && params.job_ids ? (data && data.jobs_json ? JSON.parse(data.jobs_json).map((j) => `${j.job_id.slice(-6)}:${j.job_status}`).join(' ') : JSON.stringify(body).slice(0, 160))
        : JSON.stringify(data || body).slice(0, 300);
      note(`${name} (${ms} ms)`, brief);
      if (status === 200 && body && body.success !== false) ok(body); else (err || (() => {}))(body);
    }).catch((e) => { note(name, 'FETCH ERROR', e.message); (err || (() => {}))(e); });
  },
};
globalThis.window = { location: { pathname: '/so-list' } };
globalThis.db = { collection: () => ({ where: () => ({ get: async () => ({ data: [SETUP] }) }) }) };

// the SO ids by number, looked up beforehand with .dbtools/db --dev and passed in SO_IDS
const SO_IDS = JSON.parse(process.env.SO_IDS || '{}');
const records = SOS.map((no) => ({ id: SO_IDS[no], so_no: no, customer_name: { id: 'C', customer_com_name: 'Test customer' } }));
if (records.some((x) => !x.id)) throw new Error('SO_IDS env must map every SO number to its id');
note('converting', records.map((x) => x.so_no).join(', '));
new Function(code).call(ctx, { selectedRecords: records, plantID: PLANT, organizationID: ORG });

// wait until the summary shows, then until the background starts stop (the beat ends once every job ended)
for (let i = 0; i < 600 && !alerts.length; i++) await new Promise((res) => setTimeout(res, 500));
note('summary shown; background continues');
const deadline = Date.now() + 8 * 60 * 1000;
let quietSince = Date.now(), kicks = log.filter((l) => l.includes('GD_ASYNC_WORKER')).length;
while (Date.now() < deadline) {
  await new Promise((res) => setTimeout(res, 5000));
  const now = log.filter((l) => l.includes('GD_ASYNC_WORKER')).length;
  if (now !== kicks) { kicks = now; quietSince = Date.now(); }
  if (Date.now() - quietSince > 45000) break;
}
globalThis.window.location.pathname = '/done';
note('end: no worker start for 45 s (or 8 min passed)');
fs.writeFileSync(OUT, JSON.stringify({ alerts, log }, null, 1));
process.exit(0);
