// mint_probe.mjs <identity.json> <workflowId>: READ-ONLY - does the publish service (su-code-service history, behind dev.mes) accept a
// minted token? One GET history/getCurrent of that workflow's script_json; prints the HTTP status and the version it answers.
import os from 'node:os';
import { mintToken, DEV_BASE } from './mint.mjs';

const CLI = '/Users/yunawinaya/.nvm/versions/node/v22.16.0/lib/node_modules/sudu-lowcode-cli/src';
const { roots } = await import(`${CLI}/paths.mjs`);
const { appendAudit } = await import(`${CLI}/audit.mjs`);
const [idFile, wfId] = process.argv.slice(2);
if (!idFile || !/^[0-9]{1,20}$/.test(wfId || '')) {
  console.error('usage: node mint_probe.mjs <identity.json> <workflowId>');
  process.exit(2);
}
const { token, who } = mintToken(idFile);
const url = new URL(DEV_BASE + '/su-code-service/history/getCurrent');
url.search = new URLSearchParams({ table_id: '1856231112670498818', data_id: wfId, property_name: 'script_json' }).toString();
const started = Date.now();
const res = await fetch(url, { headers: { 'Blade-Auth': `bearer ${token}`, Accept: 'application/json' } });
const text = await res.text();
let j = null;
try { j = JSON.parse(text); } catch {}
appendAudit(roots(), { osUser: os.userInfo().username, profile: 'minted:' + who.tenant_id + ':' + who.account, endpoint: DEV_BASE, args: ['mint_probe', 'getCurrent', wfId], class: 'read',
  account: who.account, client: 'saber3', result: `http:${res.status}`, durationMs: Date.now() - started });
const d = j && j.data;
console.log(`getCurrent as ${who.account}@${who.tenant_id}: HTTP ${res.status}, code ${j && j.code}, msg ${j && String(j.msg || '').slice(0, 80)}` +
  (d ? `, version ${d.version_number} ${d.status}, ${String(d.script_json || '').length} chars` : ''));
