// SA V2 cost-row race (CONTRACT §15): build - and only with --live, fire - two INVENTORY_BULK_APPLY APPLY calls at the same
// material + plant from two bins (different ITEM| lock keys, shared FIFO / WA rows), operation keys SACRACE|<run>|A / B.
//
//   node scratchpad/sav2/race/fire.mjs --scenario R0|R1|R2|R3 --run R1-03 [--batch] [--delay-ms N] [--b-movements N]
//                                      [--config race/config.json] [--out DIR] [--live]
//
// Default = DRY RUN: prints both requests (B summarised), the commands it would run and what each writes; saves the request
// bodies under --out (default config.out_dir, outside the repo). No network, no child process, nothing written anywhere else.
// --live (only after the user's yes, dev only): fires B, waits --delay-ms (R0: so A lands after B's cost read; R1-R3: 0-100
// ms jitter), fires A, waits for both answers and writes <out>/<run>.fire.json (send / answer times, HTTP status, answers,
// the snowflake id window reconcile.py's timeline reads). Auth per config.auth:
//   runas - spawns scratchpad/gdc/tools/runas.mjs <identity> <workflowId> <request> <out> per call (that runner mints a
//           15-min token for a real tenant user per call; this file never touches a secret)
//   cli   - the sudu-lowcode dev-write session (scratchpad/gdc/tools/runwf.mjs pattern); tenant 000000 only
// Scenarios: R0 silent interleaving (B = b_movements: Fixed Cost filler ADD 1 / SUBTRACT 1 pairs in bin1 + ONE SUBTRACT of
// the shared FIFO item in bin2; A = ONE SUBTRACT of it in bin1, fired after B's read), R1 FIFO SUBTRACT/SUBTRACT, R2 WA
// ADD/ADD, R3 FIFO ADD/ADD (duplicate fifo_sequence). --batch: R1 / R3 on the FIFO batch item.
// After a run: python3 scratchpad/sav2/race/reconcile.py check --run <run> --before <snapshot> (+ timeline --run <run>).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f, d) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d);
const die = (m) => {
  console.error('fire.mjs: ' + m);
  process.exit(2);
};

const cfgPath = opt('--config', fs.existsSync(path.join(HERE, 'config.json')) ? path.join(HERE, 'config.json') : path.join(HERE, 'config.example.json'));
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const scenario = opt('--scenario', '');
const run = opt('--run', '');
const LIVE = flag('--live');
const BATCH = flag('--batch');
if (!['R0', 'R1', 'R2', 'R3'].includes(scenario)) die('--scenario R0|R1|R2|R3');
if (!/^R[0-3]-[0-9]{2}b?$/.test(run) || run.slice(0, 2) !== scenario) die('--run must be <scenario>-<nn>[b], e.g. ' + scenario + '-01');
if (BATCH && !['R1', 'R3'].includes(scenario)) die('--batch is for R1 / R3');
if (BATCH !== run.endsWith('b')) die('batch runs (and only they) are named <scenario>-<nn>b, e.g. ' + scenario + '-01b');
const sc = cfg.scenarios[scenario];
const opA = 'SACRACE|' + run + '|A';
const opB = 'SACRACE|' + run + '|B';
const trx = 'SACRACE|' + run;
for (const k of [opA, opB]) if (!/^[A-Za-z0-9|:._-]{1,32}$/.test(k)) die('operation key ' + k + ' breaks the engine guard (1-32 of A-Z a-z 0-9 | : . _ -)');
const idx = Number(run.slice(3, 5)) - 1;
const delayMs = Number(opt('--delay-ms', (sc.delays_ms || [])[idx % (sc.delays_ms || [0]).length] ?? 0));
const outDir = opt('--out', cfg.out_dir);
if (!outDir) die('no --out and no config.out_dir');
if (path.resolve(outDir).startsWith(REPO + path.sep)) die('--out is inside the repo (request bodies carry tenant ids)');

const matKey = BATCH ? 'fifo_batch' : sc.material;
const mat = cfg.materials[matKey];
const filler = cfg.materials.filler;
const ph = (m) => m.id || '<' + m.code + ' id>';
const mv = (key, direction, m, binKey, qty, price, batchId) => {
  const o = {
    movement_key: key, direction, plant_id: cfg.plant_id, organization_id: cfg.organization_id, material_id: ph(m), quantity: qty,
    material_uom: cfg.uom_id, transaction_type: 'SA', trx_no: trx, inventory_category: 'Unrestricted', location_id: cfg.bins[binKey],
    batch_id: batchId || null, manufacturing_date: null, expired_date: null, doc_date: cfg.seed.doc_date, isMovingInv: 0, unit_price: price || 0,
  };
  if (direction === 'ADD') Object.assign(o, { remark: null, remark2: null, remark3: null });
  return o;
};
const batchId = BATCH ? mat.batch_id || '<SACRACE-B1 batch id>' : null;
const one = (side, binKey) => [mv('M1', sc[side].direction, mat, binKey, sc[side].qty, sc[side].unit_price, batchId)];
let movesA;
let movesB;
if (scenario === 'R0') {
  const n = Number(opt('--b-movements', sc.b_movements || 1000));
  if (!(n >= 2 && n <= 5000)) die('--b-movements 2..5000 (the engine takes at most 5,000 per operation)');
  movesB = [];
  for (let i = 1; i < n; i++) movesB.push(mv('M' + i, i % 2 ? 'ADD' : 'SUBTRACT', filler, 'bin1', 1, 0, null));
  movesB.push(mv('M' + n, sc.b.direction, mat, 'bin2', sc.b.qty, sc.b.unit_price, null));
  movesA = one('a', 'bin1');
} else {
  movesA = one('a', 'bin1');
  movesB = one('b', 'bin2');
}
const reqA = { operation_key: opA, mode: 'APPLY', organization_id: cfg.organization_id, movements: movesA };
const reqB = { operation_key: opB, mode: 'APPLY', organization_id: cfg.organization_id, movements: movesB };
const wf = cfg.workflows.INVENTORY_BULK_APPLY;

fs.mkdirSync(outDir, { recursive: true });
const fA = path.join(outDir, run + '.A.json');
const fB = path.join(outDir, run + '.B.json');
fs.writeFileSync(fA, JSON.stringify(reqA, null, 1));
fs.writeFileSync(fB, JSON.stringify(reqB, null, 1));

const brief = (m) => `${m.movement_key} ${m.direction} ${m.quantity} of ${m.material_id} in ${m.location_id}${m.batch_id ? ' batch ' + m.batch_id : ''}${m.direction === 'ADD' ? ' @ ' + m.unit_price : ''}`;
console.log(`${LIVE ? 'LIVE' : 'DRY RUN'} ${scenario} run ${run}${BATCH ? ' (batch)' : ''} - ${sc.about}`);
console.log(`  tenant ${cfg.tenant_id}, org ${cfg.organization_id}, plant ${cfg.plant_id}, engine ${wf}, auth ${cfg.auth}`);
console.log(`  B ${opB}: ${movesB.length} movement(s): ` + (movesB.length <= 4 ? movesB.map(brief).join('; ') : movesB.slice(0, 2).map(brief).join('; ') + ' ... ' + movesB.slice(-2).map(brief).join('; ')));
console.log(`  A ${opA}: ${movesA.map(brief).join('; ')}`);
console.log(`  order: B, then A ${delayMs} ms after B is sent` + (scenario === 'R0' ? ' (A must land after B\'s cost read and finish before B\'s cost write - reconcile.py timeline proves it)' : ''));
console.log(`  writes (live): ${movesA.length + movesB.length} inventory_movement rows (operation_effect_key ${trx}|A|M1, ${trx}|B|M1..); item_balance of the touched bins;`);
console.log('                 ' + (mat.method === 'Weighted Average' ? 'the WA row of ' + mat.code : 'FIFO layers of ' + mat.code + (sc.a.direction === 'ADD' ? ' (2 new layers)' : ' (consumption)')) + '; per op IBA|I|nnn + IBA|DONE step rows; lock rows taken + released');
console.log(`  requests: ${fA}  ${fB}`);
const cmd = (req, out) => (cfg.auth === 'cli' ? `node scratchpad/gdc/tools/runwf.mjs ${wf} ${req} ${out}` : `node scratchpad/gdc/tools/runas.mjs ${cfg.identity} ${wf} ${req} ${out}`);
console.log('  equivalent single calls: ' + cmd(fB, fB.replace(/\.json$/, '.out.json')) + '  |  ' + cmd(fA, fA.replace(/\.json$/, '.out.json')));
if (!LIVE) {
  console.log('dry run: nothing sent. Fire with --live after the user\'s yes (take reconcile.py snapshot first).');
  process.exit(0);
}

// ----------------------------------------------------------------------------------------------- live (dev only)
if (cfg.env !== 'dev' || !/^https:\/\/dev\.mes\.sudu\.ai\/api\/?$/.test(cfg.endpoint)) die('live runs are dev only (config.env / endpoint)');
for (const r of [reqA, reqB]) for (const m of r.movements) if (!/^[0-9]{1,20}$/.test(m.material_id) || (m.batch_id !== null && !/^[0-9]{1,20}$/.test(m.batch_id))) die('material / batch ids are not filled in the config');
const fireFile = path.join(outDir, run + '.fire.json');
if (fs.existsSync(fireFile)) die(fireFile + ' exists: this run was fired already (the engine would only replay its stored answers) - use a new run id');
const EPOCH = 1288834974657n;
const idOf = (ms) => ((BigInt(ms) - EPOCH) << 22n).toString();

let post;
if (cfg.auth === 'cli') {
  if (cfg.tenant_id !== '000000') die('auth cli runs as tenant 000000 (junaxanto); this config is tenant ' + cfg.tenant_id + ' - use auth runas');
  const CLI = '/Users/yunawinaya/.nvm/versions/node/v22.16.0/lib/node_modules/sudu-lowcode-cli/src';
  const { roots } = await import(`${CLI}/paths.mjs`);
  const { resolveProfile } = await import(`${CLI}/profiles.mjs`);
  const { ensureFresh } = await import(`${CLI}/auth/session.mjs`);
  const { appendAudit } = await import(`${CLI}/audit.mjs`);
  const r = roots();
  const profile = resolveProfile(r, 'dev-write');
  if (!/\.dev\./.test(profile.endpoint)) die(`profile ${profile.name} is not a dev endpoint`);
  if (!profile.allowWrites) die(`profile ${profile.name} is read-only`);
  const session = await ensureFresh(r, profile.name, { fetchImpl: fetch });
  post = async (req, out) => {
    const t = Date.now();
    const res = await fetch(cfg.endpoint.replace(/\/+$/, '') + `/su-code-workflow/workflow/run/${wf}`, {
      method: 'POST',
      headers: { 'Blade-Auth': `bearer ${session.accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: fs.readFileSync(req, 'utf8'),
    });
    const text = await res.text();
    fs.writeFileSync(out, text);
    appendAudit(r, { osUser: os.userInfo().username, profile: profile.name, endpoint: profile.endpoint, args: ['sacrace-fire', wf, req], class: 'write',
      account: session.account ?? null, client: session.clientId ?? null, result: `http:${res.status}`, durationMs: Date.now() - t });
    return { http: res.status, text };
  };
} else if (cfg.auth === 'runas') {
  const ident = JSON.parse(fs.readFileSync(path.join(REPO, cfg.identity), 'utf8'));
  if (String(ident.tenant_id) !== String(cfg.tenant_id)) die(`identity ${cfg.identity} is tenant ${ident.tenant_id}, config is ${cfg.tenant_id}`);
  post = (req, out) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [path.join(REPO, 'scratchpad/gdc/tools/runas.mjs'), path.join(REPO, cfg.identity), wf, req, out], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
      let log = '';
      p.stdout.on('data', (d) => (log += d));
      p.stderr.on('data', (d) => (log += d));
      p.on('close', (code) => resolve({ http: code === 0 ? 'exit 0' : 'exit ' + code, text: fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '', log: log.slice(0, 2000) }));
    });
} else die('config.auth must be runas or cli');

const t0 = Date.now();
const sentB = Date.now();
const pB = post(fB, fB.replace(/\.json$/, '.out.json')).then((x) => Object.assign(x, { doneAt: Date.now() }));
await new Promise((r) => setTimeout(r, delayMs));
const sentA = Date.now();
const pA = post(fA, fA.replace(/\.json$/, '.out.json')).then((x) => Object.assign(x, { doneAt: Date.now() }));
const [rB, rA] = await Promise.all([pB, pA]);
const answer = (x) => {
  try {
    const j = JSON.parse(x.text);
    const d = j && j.data && typeof j.data === 'object' ? (j.data.data && typeof j.data.data === 'object' ? j.data.data : j.data) : j;
    return { code: d && d.code, result_code: d && d.result_code, message: String((d && d.message) || '').slice(0, 300), summary: d && d.summary };
  } catch (e) {
    return { unparsed: String(x.text).slice(0, 300) };
  }
};
const rec = {
  run, scenario, batch: BATCH, opA, opB, trx, delayMs, tenant: cfg.tenant_id, organization_id: cfg.organization_id, plant_id: cfg.plant_id,
  material: mat.id, sentB, sentA, doneB: rB.doneAt, doneA: rA.doneAt, httpB: rB.http, httpA: rA.http, answerB: answer(rB), answerA: answer(rA),
  idWindow: [idOf(t0 - 2000), idOf(Math.max(rA.doneAt, rB.doneAt) + 5000)], movementsA: movesA.length, movementsB: movesB.length,
};
fs.writeFileSync(fireFile, JSON.stringify(rec, null, 1));
console.log(`B ${opB}: ${rec.httpB} in ${rB.doneAt - sentB} ms -> ${JSON.stringify(rec.answerB).slice(0, 300)}`);
console.log(`A ${opA}: ${rec.httpA} in ${rA.doneAt - sentA} ms (sent ${sentA - sentB} ms after B) -> ${JSON.stringify(rec.answerA).slice(0, 300)}`);
console.log(`saved ${fireFile}; next: python3 scratchpad/sav2/race/reconcile.py check --run ${rec.run} --before <snapshot> && python3 scratchpad/sav2/race/reconcile.py timeline --run ${rec.run}`);
