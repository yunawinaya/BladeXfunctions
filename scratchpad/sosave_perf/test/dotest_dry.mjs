// scratchpad/gdc/tools/dotest.mjs with dryRun: true - the platform runs the exact JSON but its add / update / delete nodes do
// not persist (sub-workflow calls do: give it only requests whose sub-workflows write nothing). DEV only, CLI session + audit.
//
//   node scratchpad/sosave_perf/test/dotest_dry.mjs <workflowId> <flowgram.json> <request.json> <out.json>
import fs from 'node:fs';
import os from 'node:os';

const CLI = '/Users/yunawinaya/.nvm/versions/node/v22.16.0/lib/node_modules/sudu-lowcode-cli/src';
const { roots } = await import(`${CLI}/paths.mjs`);
const { resolveProfile } = await import(`${CLI}/profiles.mjs`);
const { ensureFresh } = await import(`${CLI}/auth/session.mjs`);
const { appendAudit } = await import(`${CLI}/audit.mjs`);

const [wfId, scriptFile, requestFile, outFile] = process.argv.slice(2);
if (!/^[0-9]{1,20}$/.test(wfId || '') || !scriptFile || !requestFile || !outFile) {
  console.error('usage: node dotest_dry.mjs <workflowId> <flowgram.json> <request.json> <out.json>');
  process.exit(2);
}
const r = roots();
const profile = resolveProfile(r, 'dev-main-write');
if (!/^https:\/\/([a-z0-9-]+\.)?dev\.mes\.sudu\.ai\/api$/.test(profile.endpoint.replace(/\/+$/, ''))) throw new Error(`profile ${profile.name} is not a dev endpoint`);
if (!profile.allowWrites) throw new Error(`profile ${profile.name} is read-only`);
const session = await ensureFresh(r, profile.name, { fetchImpl: fetch });
const BASE = 'https://dev.mes.sudu.ai/api';
const scriptJson = JSON.stringify(JSON.parse(fs.readFileSync(scriptFile, 'utf8')));
const request = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
const started = Date.now();
const res = await fetch(BASE + `/su-code-workflow/workflow/doTest/${wfId}`, {
  method: 'POST',
  headers: { 'Blade-Auth': `bearer ${session.accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' },
  body: JSON.stringify({ scriptJson, request, dryRun: true }),
});
const text = await res.text();
fs.writeFileSync(outFile, text);
let j = null;
try { j = JSON.parse(text); } catch { /* not JSON */ }
const d = j && j.data && typeof j.data === 'object' ? (j.data.data && typeof j.data.data === 'object' ? j.data.data : j.data) : {};
appendAudit(r, { osUser: os.userInfo().username, profile: profile.name, endpoint: profile.endpoint, args: ['dotest-dry', wfId, requestFile, BASE], class: 'write',
  account: session.account ?? null, client: session.clientId ?? null, result: `http:${res.status}`, durationMs: Date.now() - started });
console.log(`HTTP ${res.status} instance ${d.id ?? '?'} status ${d.status ?? '?'} node ${d.currentNodeId ?? '?'} ${d.runTime ?? '?'} ms`);
console.log('response:', JSON.stringify(d.responseJsonData ?? null).slice(0, 1500));
if (d.errorMsg || d.runErrorMsg) console.log('error:', JSON.stringify(d.errorMsg ?? d.runErrorMsg).slice(0, 600));
