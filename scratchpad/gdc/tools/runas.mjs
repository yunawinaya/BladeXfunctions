// Run a DEV workflow as a given BladeX identity (POST /su-code-workflow/workflow/run/{id} on dev.mes), with a short-lived
// HS256 token minted the way sudu-dealer-api's SaasTokenProvider mints (same claim set) from the DEV BLADE_JWT_SECRET in
// sudu-dealer-api/.env, read at run time. User-approved 2026-10-14. The secret and the token are never printed or written.
//
//   node scratchpad/gdc/tools/runas.mjs <identity.json> <workflowId> <request.json> <out.json> [--test <flowgram.json>] [--also <req>=<out>,...]
// identity.json: { tenant_id, user_id, account, dept_id, role_id, first_lv_dept_id } of a REAL user (create_user is filled
// from user_id)
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

const CLI = '/Users/yunawinaya/.nvm/versions/node/v22.16.0/lib/node_modules/sudu-lowcode-cli/src';
const { roots } = await import(`${CLI}/paths.mjs`);
const { appendAudit } = await import(`${CLI}/audit.mjs`);

const [idFile, wfId, requestFile, outFile] = process.argv.slice(2);
// --test <flowgram.json>: run that exact JSON (doTest, nothing published) instead of the stored version
const testAt = process.argv.indexOf('--test');
const testFile = testAt > 0 ? process.argv[testAt + 1] : null;
if (!idFile || !/^[0-9]{1,20}$/.test(wfId || '') || !requestFile || !outFile || (testAt > 0 && !testFile)) {
  console.error('usage: node runas.mjs <identity.json> <workflowId> <request.json> <out.json> [--test <flowgram.json>]');
  process.exit(2);
}
const env = {};
for (const line of fs.readFileSync('/Users/yunawinaya/Developer/sudu-dealer-api/.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const BASE = 'https://dev.mes.sudu.ai/api';
if ((env.BLADE_BASE_URL || '').replace(/\/+$/, '') !== 'https://dev.mes.sudu.ai') throw new Error('sudu-dealer-api/.env is not paired with dev.mes: refusing');
if (!env.BLADE_JWT_SECRET) throw new Error('BLADE_JWT_SECRET not set in sudu-dealer-api/.env');
const who = JSON.parse(fs.readFileSync(idFile, 'utf8'));
for (const k of ['tenant_id', 'user_id', 'account', 'dept_id', 'role_id', 'first_lv_dept_id']) if (!who[k]) throw new Error('identity lacks ' + k);

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const claims = {
  iss: 'bladex.cn', aud: ['bladex'], token_type: 'access_token', client_id: 'saber3', tenant_id: who.tenant_id, user_id: who.user_id,
  account: who.account, user_name: who.account, nick_name: who.account, real_name: who.account, dept_id: who.dept_id, role_id: who.role_id,
  detail: { type: 'web', first_lv_dept_id: Number(who.first_lv_dept_id) }, nbf: now, iat: now, exp: now + 900,
};
const unsigned = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64(claims);
const token = unsigned + '.' + crypto.createHmac('sha256', env.BLADE_JWT_SECRET).update(unsigned).digest('base64url');

// --also <request.json>=<out.json>[=<workflowId>[=<flowgram.json>]][,...]: more requests sent at the same moment as the first
// (concurrency tests); each defaults to the main workflow id and --test file
const alsoAt = process.argv.indexOf('--also');
const pairs = [[requestFile, outFile]].concat(alsoAt > 0 ? process.argv[alsoAt + 1].split(',').map((p) => p.split('=')) : []);
for (const [, , w] of pairs) if (w && !/^[0-9]{1,20}$/.test(w)) throw new Error('--also workflow id must be digits: ' + w);
const send = (rq, wf, tf) => tf
  ? fetch(BASE + `/su-code-workflow/workflow/doTest/${wf}`, {
      method: 'POST',
      headers: { 'Blade-Auth': `bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ scriptJson: JSON.stringify(JSON.parse(fs.readFileSync(tf, 'utf8'))), request: JSON.parse(fs.readFileSync(rq, 'utf8')), dryRun: false }),
    })
  : fetch(BASE + `/su-code-workflow/workflow/run/${wf}`, {
      method: 'POST',
      headers: { 'Blade-Auth': `bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: fs.readFileSync(rq, 'utf8'),
    });
await Promise.all(pairs.map(async ([rq, of, wf, tf]) => {
  const started = Date.now();
  const res = await send(rq, wf || wfId, wf ? tf || null : testFile);
  const text = await res.text();
  fs.writeFileSync(of, text);
  const usedTest = wf ? tf || null : testFile;
  appendAudit(roots(), { osUser: os.userInfo().username, profile: 'minted:' + who.tenant_id + ':' + who.account, endpoint: BASE, args: ['runas', wf || wfId, rq].concat(usedTest ? ['--test', usedTest] : []), class: 'write',
    account: who.account, client: 'saber3', result: `http:${res.status}`, durationMs: Date.now() - started });
  console.log(`${BASE} as ${who.account}@${who.tenant_id} HTTP ${res.status} ${Date.now() - started} ms` + (pairs.length > 1 ? ` (${rq})` : ''));
  console.log(text.slice(0, pairs.length > 1 ? 200 : 1500));
}));
