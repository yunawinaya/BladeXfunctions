// Replay recorded code-node executions: a run record holds each code node's code (placeholders unfilled), the values of
// its placeholders (variableMap: "node:x.data" -> value, injected as JSON text) and its output. Each recorded execution
// runs twice - as recorded, and with the build's code for that node - in a fresh sandbox with a fixed clock and random
// seed, and the two returned objects are compared.
//
//   node scratchpad/sosave_perf/test/replay.mjs <base.json> <patched.json> <runs.json> [--shake] [--datetime-only <nodeId>]
//
// patched.json: the build BEFORE trimming; its change to a node's code (the one region where base and patched differ) is
// applied to the recorded code. --shake: also trim the result with ../shake.mjs. --datetime-only <nodeId>: for that node a
// difference passes when every line op / cell it drops was a datetime-only difference (Task 3).
// runs.json: [{id, nodes_data}] rows of su_code_workflow_inst (prod data: keep it out of the repo).
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const args = process.argv.slice(2);
const [baseFile, patchedFile, runsFile] = args;
const SHAKE = args.includes('--shake');
const dtAt = args.indexOf('--datetime-only');
const DT_NODE = dtAt >= 0 ? args[dtAt + 1] : '';
// --small-route <nodeId>: for that node (SUBMIT's code_node_SSentry) a difference passes when the recorded answer was GO for
// a SUBMIT of <= 100 lines and the build answers NOT_ELIGIBLE / SOV2_SMALL, every other key the same
const srAt = args.indexOf('--small-route');
const SR_NODE = srAt >= 0 ? args[srAt + 1] : '';
// --also <doc.json>: another version records may have run (e.g. one already published); its records map to patched too
const alsoAt = args.indexOf('--also');
const ALSO_FILE = alsoAt >= 0 ? args[alsoAt + 1] : '';
if (!baseFile || !patchedFile || !runsFile) {
  console.error('usage: node replay.mjs <base.json> <patched.json> <runs.json> [--shake] [--datetime-only <nodeId>]');
  process.exit(2);
}
const shake = SHAKE ? (await import(new URL('../shake.mjs', import.meta.url))).shake : null;

const codeNodes = (file) => {
  const out = {};
  const walk = (ns) => ns.forEach((n) => { if (n.type === 'code-node') out[n.id] = n.data.script.code; walk(n.blocks || []); });
  walk(JSON.parse(fs.readFileSync(file, 'utf8')).nodes);
  return out;
};
const base = codeNodes(baseFile);
const patched = codeNodes(patchedFile);
const also = ALSO_FILE ? codeNodes(ALSO_FILE) : {};

// the one region where base and patched code differ (common prefix / suffix, widened by up to 200 chars of shared context
// so an insertion has a unique anchor); null when identical. Used only for a record whose code is not the base's.
const regionOf = (a, b) => {
  if (a === b) return null;
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  p = Math.max(0, p - 200);
  s = Math.max(0, s - 200);
  return { from: a.slice(p, a.length - s), to: b.slice(p, b.length - s) };
};
const regions = {};
for (const id of Object.keys(base)) regions[id] = patched[id] !== undefined ? regionOf(base[id], patched[id]) : null;
// fill {{key}} from the record's variableMap, as the platform injects it (JSON text); an unknown key becomes null
const fill = (code, vars) => code.replace(/\{\{([^}]+)\}\}/g, (m, key) => (vars && key in vars ? JSON.stringify(vars[key]) : 'null'));

const FIXED = Date.UTC(2026, 9, 27, 4, 0, 0);
const PRELUDE = `Date = (function (D) { class FixedDate extends D { constructor(...a) { if (a.length) super(...a); else super(${FIXED}); } static now() { return ${FIXED}; } } return FixedDate; })(Date);
Math.random = (function () { let x = 42; return function () { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; })();`;
const run = (code) => {
  const ctx = vm.createContext({ console: { log() {}, error() {}, warn() {}, info() {} } });
  vm.runInContext(PRELUDE, ctx);
  try {
    return { value: vm.runInContext(`(function () {\n${code}\n})()`, ctx, { timeout: 30000 }) };
  } catch (e) {
    return { error: String(e && e.message ? e.message : e) };
  }
};
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, key) => ((o[key] = x[key]), o), {}) : x));

// Task 3: the plan may only lose line ops / cells whose two sides are the same datetime
const DT = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2})(?:\.0+)?)?$/;
const dtNorm = (v) => { const m = String(v == null ? '' : v).trim().match(DT); return m ? m[1] + ' ' + (m[2] || '00:00:00') : null; };
const dtSame = (a, b) => dtNorm(a) !== null && dtNorm(a) === dtNorm(b);
const planOps = (out) => {
  const ops = {};
  let header = {};
  for (const pr of (out && out.planRows) || []) {
    let body;
    try { body = JSON.parse(pr.result_ref || 'null'); } catch { continue; }
    if (String(pr.step_name || '').startsWith('L|')) for (const o of body || []) if (o.op === 'U') ops[o.id] = o;
    if (pr.step_name === 'H|000' && body && body.set) header = { set: body.set, before: body.before || {} };
  }
  return { ops, header };
};
const datetimeOnly = (a, b) => {
  const A = planOps(a); const B = planOps(b);
  const problems = [];
  for (const [id, o] of Object.entries(A.ops)) {
    const n = B.ops[id];
    for (const [c, v] of Object.entries(o.set || {})) {
      if (n && c in (n.set || {})) continue;
      if (!dtSame(v, (o.before || {})[c])) problems.push(`line ${id} ${c}: ${JSON.stringify((o.before || {})[c])} -> ${JSON.stringify(v)} dropped`);
    }
  }
  for (const id of Object.keys(B.ops)) if (!A.ops[id]) problems.push(`line ${id}: a new op`);
  for (const [c, v] of Object.entries(A.header.set || {})) {
    if (B.header.set && c in B.header.set) continue;
    if (!dtSame(v, (A.header.before || {})[c])) problems.push(`header ${c} dropped`);
  }
  return { problems, before: Object.keys(A.ops).length, after: Object.keys(B.ops).length };
};

const rows = JSON.parse(fs.readFileSync(runsFile, 'utf8'));
const stats = {};
let opsBefore = 0, opsAfter = 0;
for (const r of rows) {
  let nodes;
  try { nodes = JSON.parse(r.nodes_data || '[]'); } catch { continue; }
  for (const n of nodes) {
    if (n.node_type !== 'code-node' || !(n.node_id in base)) continue;
    let rq;
    try { rq = JSON.parse(n.request_json_data); } catch { continue; }
    const recorded = rq && rq.code;
    if (typeof recorded !== 'string') continue;
    const st = (stats[n.node_id] ||= { runs: 0, same: 0, diff: 0, notApplied: 0, errors: 0, first: '' });
    // a large run's inputs go to a file the database does not hold: nothing to replay with
    if (n.request_is_writer_file) { st.offloaded = (st.offloaded || 0) + 1; continue; }
    st.runs++;
    // the build's code for this node: exact when the record ran the base version, else the patch region applied to it
    let changed;
    if (recorded === base[n.node_id] || (also[n.node_id] !== undefined && recorded === also[n.node_id])) changed = patched[n.node_id] !== undefined ? patched[n.node_id] : recorded;
    else {
      st.otherVersion = (st.otherVersion || 0) + 1;
      changed = recorded;
      const reg = regions[n.node_id];
      if (reg) {
        const at = changed.indexOf(reg.from);
        if (at < 0 || changed.indexOf(reg.from, at + 1) >= 0) { st.notApplied++; continue; }
        changed = changed.slice(0, at) + reg.to + changed.slice(at + reg.from.length);
      }
    }
    if (shake) changed = shake(changed);
    const code = fill(recorded, rq.variableMap);
    const changedCode = fill(changed, rq.variableMap);
    const a = run(code);
    const b = changedCode === code ? a : run(changedCode);
    // the sandbox must reproduce what the platform recorded (its declared keys), or the comparison means nothing
    try {
      const rec = JSON.parse(n.response_json_data || 'null');
      const data = rec && rec.data && typeof rec.data === 'object' ? rec.data : null;
      if (data && a.value && typeof a.value === 'object') {
        // the platform keeps the declared keys and drops null-valued ones (deep)
        const noNulls = (v) => (Array.isArray(v) ? v.map(noNulls) : v && typeof v === 'object'
          ? Object.keys(v).reduce((o, k) => (v[k] === null ? o : ((o[k] = noNulls(v[k])), o)), {}) : v);
        const picked = {};
        for (const k of Object.keys(data)) picked[k] = a.value[k];
        const asText = (v) => JSON.stringify(noNulls(v), (k, x) => (typeof x === 'number' ? String(x) : x));
        if (canon(noNulls(picked)) === canon(noNulls(data)) || asText(picked) === asText(data)) st.repro = (st.repro || 0) + 1;
      }
    } catch { /* unreadable record */ }
    if (a.error || b.error) {
      // both threw the same: the node's behaviour is unchanged, but the sandbox could not run it - counted apart
      if (a.error && b.error && a.error === b.error) { st.same++; st.bothErr = (st.bothErr || 0) + 1; st.firstErr ||= a.error.slice(0, 160); continue; }
      st.errors++;
      st.first ||= `run ${r.id}: recorded ${a.error || 'ok'} / changed ${b.error || 'ok'}`;
      continue;
    }
    if (canon(a.value) === canon(b.value)) { st.same++; continue; }
    if (n.node_id === SR_NODE) {
      const g = (rq.variableMap || {})['node:code_node_SSguard.data'] || {};
      const rest = (v) => { const o = Object.assign({}, v); for (const k of ['route', 'code', 'message', 'reason']) delete o[k]; return canon(o); };
      if (a.value.route === 'GO' && b.value.route === 'NOT_ELIGIBLE' && b.value.message === 'SOV2_SMALL' && g.operation === 'SUBMIT'
          && Number(g.lineCount || 0) <= 100 && rest(a.value) === rest(b.value)) { st.same++; st.small = (st.small || 0) + 1; continue; }
      st.first ||= `run ${r.id}: ${a.value.route} -> ${b.value.route} (${b.value.message}), lines ${g.lineCount}`;
      st.diff++;
      continue;
    }
    if (n.node_id === DT_NODE) {
      const d = datetimeOnly(a.value, b.value);
      opsBefore += d.before; opsAfter += d.after;
      if (!d.problems.length) { st.same++; st.dtOnly = (st.dtOnly || 0) + 1; continue; }
      st.first ||= `run ${r.id}: ${d.problems.slice(0, 3).join('; ')}`;
    } else st.first ||= `run ${r.id}: outputs differ`;
    st.diff++;
  }
}
let bad = 0;
for (const [id, st] of Object.entries(stats).sort()) {
  const ok = st.diff === 0 && st.errors === 0 && st.notApplied === 0;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id.padEnd(28)} runs ${String(st.runs).padStart(4)}  identical ${String(st.same).padStart(4)}${st.dtOnly ? ` (of which datetime-only ${st.dtOnly})` : ''}${st.small ? ` (of which small-save route ${st.small})` : ''}  differ ${st.diff}  errors ${st.errors}  not applied ${st.notApplied}  reproduces the record ${st.repro || 0}/${st.runs}${st.otherVersion ? `  other version ${st.otherVersion}` : ''}${st.bothErr ? `  both threw ${st.bothErr} (${st.firstErr})` : ''}${st.offloaded ? `  inputs not recorded ${st.offloaded}` : ''}${st.first ? '\n     ' + st.first : ''}`);
}
if (DT_NODE) console.log(`line update ops in ${DT_NODE}: ${opsBefore} -> ${opsAfter} (runs whose plan changed)`);
console.log(bad ? `${bad} node(s) FAILED` : `all ${Object.keys(stats).length} replayed nodes passed`);
process.exit(bad ? 1 : 0);
