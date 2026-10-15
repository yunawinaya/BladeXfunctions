// Harness (a): every lifted GR_REVERT_COMPLETED body (grRvParams, grRvPrep, grRvBuild) that ran in a recorded run, re-run on
// that node's own recorded inputs (the variableMap the platform substituted) against the output it recorded.
// usage: TZ=Asia/Kuala_Lumpur node lifted_vs_recorded.js <runs.jsonl> [...]   (fixtures from fetch_grrv_runs.py)
// The deployed body (lift/lifted_prepare.js) runs on every record. When the run used an older body (prod's grRvPrep lacks the
// 500-line guard; early dev runs rounded to 3 / 4 dp), that recorded body is lifted the same way and run too: it must
// reproduce its own record (the harness is right), and the deployed body's differences are listed (the version's, not
// the lift's). grRvBuild reads the clock once (doc_date): the run's own doc_date is used when it falls inside the node's
// recorded start / end.
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const D = path.join(__dirname, "..");
if (new Date(2026, 0, 1).getTimezoneOffset() !== -480) {
  console.error("run with TZ=Asia/Kuala_Lumpur (UTC+8), as the platform does");
  process.exit(2);
}
const IDS = ["code_node_grRvParams", "code_node_grRvPrep", "code_node_grRvBuild"];
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);

function sandbox() {
  const sb = { JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Symbol };
  const RealDate = Date;
  let now = RealDate.now();
  function FakeDate(...a) {
    if (!(this instanceof FakeDate)) return new RealDate(now).toString();
    return a.length ? new RealDate(...a) : new RealDate(now);
  }
  FakeDate.now = () => now;
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  FakeDate.prototype = RealDate.prototype;
  sb.Date = FakeDate;
  sb.__setNow = (t) => { now = t; };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(D + "/lift/runtime.js", "utf8"), sb);
  vm.runInContext(fs.readFileSync(D + "/lift/lifted_prepare.js", "utf8") + "\nthis.__N = __N; this.__run = __run; this.__setCtx = (c) => { __CTX = c; };", sb);
  return sb;
}
// a recorded body lifted as lift.py lifts it
function liftOld(sb, id, code, decl) {
  const body = code.replace(/\{\{([^{}]+?)\}\}/g, (m, k) => "__v(" + JSON.stringify(k) + ")");
  vm.runInContext(`__N[${JSON.stringify(id + "#old")}] = { decl: ${JSON.stringify(decl)}, fn: function () {\nconst console = __QUIET;\n${body}\n} };`, sb);
}
function put(ctx, token, value) {
  const dot = token.indexOf(".", token.indexOf(":") + 1);
  if (dot < 0) {
    ctx[token] = value;
    return;
  }
  const base = token.slice(0, dot);
  const keys = token.slice(dot + 1).split(".");
  let o = (ctx[base] = ctx[base] && typeof ctx[base] === "object" ? ctx[base] : {});
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] = o[keys[i]] && typeof o[keys[i]] === "object" ? o[keys[i]] : {};
  o[keys[keys.length - 1]] = value;
}
function diffPaths(a, b, p, out) {
  if (out.length > 8) return;
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
    if (Array.isArray(a) && a.length !== b.length) out.push(`${p}: ${a.length} items | rec ${b.length}`);
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffPaths(a[k], b[k], p + "." + k, out);
  } else out.push(`${p}: ${JSON.stringify(a)?.slice(0, 90)} | rec ${JSON.stringify(b)?.slice(0, 90)}`);
}

const sb = sandbox();
const src = {};
(function walk(o) {
  if (Array.isArray(o)) o.forEach(walk);
  else if (o && typeof o === "object") {
    if (o.type === "code-node" && o.data && o.data.script) src[o.id] = o.data.script.code;
    Object.values(o).forEach(walk);
  }
})(JSON.parse(fs.readFileSync(path.join(D, "..", "..", "Goods Receiving", "RevertCompletedGR", "GRrevertCompletedWorkflow.json"), "utf8")));

const tally = {};
const notes = [];
let runs = 0;
let failed = 0;
for (const file of process.argv.slice(2)) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    runs++;
    for (const id of IDS) {
      const n = r.nodes[id];
      if (!n || !n.resp || n.resp.data === undefined) continue;
      const older = n.code !== undefined && n.code !== src[id];
      const t = (tally[id] = tally[id] || { same: 0, diff: 0, threw: 0, older: 0, olderSelf: 0, olderSelfDiff: 0 });
      const rec = n.resp.data;
      const ctx = { "system:tenantId": r.tenant };
      for (const [k, v] of Object.entries(n.vars || {})) put(ctx, k, v);
      const docDate = id === "code_node_grRvBuild" && rec.subtracts && rec.subtracts[0] ? Date.parse(rec.subtracts[0].doc_date) : NaN;
      const clock = Number.isFinite(docDate) && docDate >= (n.t0 || 0) - 5 && docDate <= (n.t1 || Infinity) + 5 ? docDate : n.t0 || r.t0;
      const run = (nid) => {
        sb.__setNow(clock);
        sb.__setCtx(JSON.parse(JSON.stringify(ctx)));
        return JSON.stringify(canon(sb.__run(nid)));
      };
      const b = JSON.stringify(canon(rec));
      let a;
      try {
        a = run(id);
      } catch (e) {
        t.threw++;
        failed++;
        notes.push(`${r.env} ${r.id} ${id} THREW ${String(e).slice(0, 160)}`);
        continue;
      }
      if (older) {
        t.older++;
        liftOld(sb, id, n.code, n.decl || []);
        const self = run(id + "#old");
        if (self === b) t.olderSelf++;
        else {
          t.olderSelfDiff++;
          failed++;
          const out = [];
          diffPaths(JSON.parse(self), JSON.parse(b), "", out);
          notes.push(`${r.env} ${r.id} ${id} RECORDED BODY does not reproduce its record:\n      ` + out.join("\n      "));
        }
      }
      if (a === b) t.same++;
      else {
        t.diff++;
        if (!older) failed++;
        const out = [];
        diffPaths(JSON.parse(a), JSON.parse(b), "", out);
        notes.push(`${r.env} ${r.id} ${id} (${older ? "older body recorded: deployed body differs" : "DEPLOYED BODY"}) exit ${r.exit}:\n      ` + out.join("\n      "));
      }
    }
  }
}
console.log("runs", runs);
for (const [id, t] of Object.entries(tally)) {
  console.log(`  ${id.padEnd(22)} deployed body: same ${t.same}, different ${t.diff}, threw ${t.threw} | runs on an older body ${t.older}: it reproduces its record ${t.olderSelf}, not ${t.olderSelfDiff}`);
}
for (const n of notes.slice(0, Number(process.env.SHOW || 40))) console.log("  " + n);
console.log(failed ? `FAILED: ${failed}` : "OK: every record reproduced (older-body differences listed above are the version's)");
process.exit(failed ? 1 : 0);
