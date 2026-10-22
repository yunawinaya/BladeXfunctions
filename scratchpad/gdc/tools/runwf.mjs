// Run a DEV workflow the way a form does (POST /su-code-workflow/workflow/run/{id}, request params as the body): the
// platform loads its STORED version. Same session + audit handling as .dbtools/wf_upload.mjs.
//
//   node scratchpad/gdc/tools/runwf.mjs <workflowId> <request.json> <out.json>
import fs from 'node:fs';
import os from 'node:os';

const CLI = '/Users/yunawinaya/.nvm/versions/node/v22.16.0/lib/node_modules/sudu-lowcode-cli/src';
const { roots } = await import(`${CLI}/paths.mjs`);
const { resolveProfile } = await import(`${CLI}/profiles.mjs`);
const { ensureFresh } = await import(`${CLI}/auth/session.mjs`);
const { appendAudit } = await import(`${CLI}/audit.mjs`);

const [wfId, requestFile, outFile] = process.argv.slice(2);
if (!/^[0-9]{1,20}$/.test(wfId || '') || !requestFile || !outFile) {
  console.error('usage: node runwf.mjs <workflowId> <request.json> <out.json>');
  process.exit(2);
}
const r = roots();
const profile = resolveProfile(r, 'dev-main-write');
if (!/^https:\/\/([a-z0-9-]+\.)?dev\.mes\.sudu\.ai\/api$/.test(profile.endpoint.replace(/\/+$/, ''))) throw new Error(`profile ${profile.name} is not a dev endpoint`);
if (!profile.allowWrites) throw new Error(`profile ${profile.name} is read-only`);
const session = await ensureFresh(r, profile.name, { fetchImpl: fetch });
// forms, Quartz and the designer run behind the browser's gateway; each gateway has its own runtime cache (bladexfunctions-fa,
// 2026-10-13), so test where the forms run: GATEWAY=cli switches to the CLI profile's gateway
const BASE = process.env.GATEWAY === 'cli' ? profile.endpoint.replace(/\/+$/, '') : 'https://dev.mes.sudu.ai/api';
const started = Date.now();
const res = await fetch(BASE + `/su-code-workflow/workflow/run/${wfId}`, {
  method: 'POST',
  headers: { 'Blade-Auth': `bearer ${session.accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' },
  body: fs.readFileSync(requestFile, 'utf8'),
});
const text = await res.text();
fs.writeFileSync(outFile, text);
appendAudit(r, { osUser: os.userInfo().username, profile: profile.name, endpoint: profile.endpoint, args: ['runwf', wfId, requestFile, BASE], class: 'write',
  account: session.account ?? null, client: session.clientId ?? null, result: `http:${res.status}`, durationMs: Date.now() - started });
console.log(`${BASE} HTTP ${res.status} ${res.headers.get('x-su-workflow-response-mode') || ''} ${Date.now() - started} ms`);
console.log(text.slice(0, 1500));
