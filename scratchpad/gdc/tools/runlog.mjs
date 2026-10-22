// runlog.mjs <identity.json> <instanceId> <out.json>: READ-ONLY - the full log of one DEV workflow run (every node's input and
// output, add / update / if nodes included), from the endpoint `sudu-lowcode workflow log` reads, with a minted DEV token: for
// while the CLI cannot log in (10-22). Written in the CLI's --plain shape, so the skill's log_nodes.py reads it. Use the
// identity of the run's tenant (su_code_workflow_inst.tenant_id).
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { mintToken, DEV_BASE } from './mint.mjs';

const CLI = '/Users/yunawinaya/.nvm/versions/node/v22.16.0/lib/node_modules/sudu-lowcode-cli/src';
const { roots } = await import(`${CLI}/paths.mjs`);
const { appendAudit } = await import(`${CLI}/audit.mjs`);
const [idFile, instId, out] = process.argv.slice(2);
if (!idFile || !/^[0-9]{1,20}$/.test(instId || '') || !out) {
  console.error('usage: node runlog.mjs <identity.json> <instanceId> <out.json>');
  process.exit(2);
}
// the server builds a log in one piece: fetching a 2,000-line run's log took dev down on 10-22 (15:14, 15:36), so small runs only
const sized = execFileSync('/Users/yunawinaya/Developer/BladeXfunctions/.dbtools/db', ['--dev', '--json', `SELECT LENGTH(nodes_data) AS nd, run_time AS rt FROM su_code_workflow_inst WHERE id = ${instId}`], { encoding: 'utf8' });
const size = JSON.parse(sized.slice(sized.indexOf('['))) [0] || {};
if (!(Number(size.nd) <= 1000000 && Number(size.rt) <= 60000)) {
  console.error(`runlog ${instId}: refused, the run is too large (node data ${size.nd ?? '?'} bytes, ${size.rt ?? '?'} ms). Use .dbtools/wf --dev trace ${instId}`);
  process.exit(3);
}
const { token, who } = mintToken(idFile);
const started = Date.now();
const res = await fetch(`${DEV_BASE}/su-code-workflow/workflow/log/content/${instId}`, { headers: { 'Blade-Auth': `bearer ${token}`, Accept: 'application/json' } });
const text = await res.text();
let j = null;
try { j = JSON.parse(text); } catch {}
appendAudit(roots(), { osUser: os.userInfo().username, profile: 'minted:' + who.tenant_id + ':' + who.account, endpoint: DEV_BASE, args: ['runlog', instId], class: 'read',
  account: who.account, client: 'saber3', result: `http:${res.status}`, durationMs: Date.now() - started });
if (!res.ok || !j || (j.success !== true && String(j.code) !== '200')) {
  console.error(`runlog ${instId}: HTTP ${res.status}, code ${j && j.code}, msg ${String((j && j.msg) || text).slice(0, 200)}`);
  process.exit(1);
}
const body = typeof j.data === 'string' ? j.data : JSON.stringify(j.data, null, 2);
fs.writeFileSync(out, JSON.stringify({ data: { lines: body.split('\n') } }));
console.log(`runlog ${instId} as ${who.account}@${who.tenant_id}: HTTP ${res.status}, ${body.length} chars -> ${out}`);
