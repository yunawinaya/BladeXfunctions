// Harness (a): every lifted PUTAWAY body that ran at the top level of a recorded run, re-run on that node's own recorded
// inputs (the variableMap the platform substituted) against the output it recorded.
// usage: TZ=Asia/Kuala_Lumpur node lifted_vs_recorded.js <runs.jsonl> [...]   (fixtures from fetch_pw_runs.py, session
// scratchpad only)
// v33 runs (prod, dev before 2026-10-14 15:56) read the Item master and the in-transit ledger through search nodes that v34
// replaced with sql-node + bridge pairs: the recorded token names are mapped to the v34 ones (search_node_6yzlT81I.data.data
// -> code_node_PwItems.data.items, search_node_ITopen.data.data -> code_node_PwTransit.data.rows); a body equal to the
// deployed one after that rename counts as the same body. S8GL6e4o v33 lacks the Phase 0 stored-pending check: it runs
// with get_node_C64LC1sr's recorded answer and is tallied apart. The loop bodies (dofqVRSn, 4Baken82) are not recorded by
// the platform: harness (b) checks them through the SUBTRACT / ADD calls they fed.
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const D = path.join(__dirname, "..");
if (new Date(2026, 0, 1).getTimezoneOffset() !== -480) {
  console.error("run with TZ=Asia/Kuala_Lumpur (UTC+8), as the platform does");
  process.exit(2);
}
const TOP = ["code_node_M7IX2sBi", "code_node_S8GL6e4o", "code_node_qfSZO0bi", "code_node_KbJLkjP8", "code_node_M7XzDZ48", "code_node_ITmatch", "code_node_ds7jurnq"];
const RENAME = [["node:search_node_6yzlT81I.data.data", "node:code_node_PwItems.data.items"], ["node:search_node_ITopen.data.data", "node:code_node_PwTransit.data.rows"]];
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);

function sandbox() {
  const sb = { JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp };
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

// a token's value placed where __resolve finds it: "node:X.data.data" -> ctx["node:X"].data.data
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
})(JSON.parse(fs.readFileSync(path.join(D, "..", "..", "Putaway", "PutawayProcessWorkflow.json"), "utf8")));
const renamed = (code) => RENAME.reduce((c, [a, b]) => c.split("{{" + a + "}}").join("{{" + b + "}}"), code);

const tally = {};
const notes = [];
let runs = 0;
for (const file of process.argv.slice(2)) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    runs++;
    for (const id of TOP) {
      const n = r.nodes[id];
      if (!n || !n.resp || n.resp.data === undefined) continue;
      const t = (tally[id] = tally[id] || { same: 0, diff: 0, olderSame: 0, olderDiff: 0, threw: 0, renamed: 0 });
      const rec = n.resp.data;
      const ctx = { "system:tenantId": r.tenant, "system:uuid": "x" };
      for (const [k, v] of Object.entries(n.vars || {})) {
        const alias = RENAME.find(([a]) => a === k);
        put(ctx, alias ? alias[1] : k, v);
      }
      const isRenamed = n.code !== undefined && n.code !== src[id] && renamed(n.code) === src[id];
      if (isRenamed) t.renamed++;
      const older = n.code !== undefined && !isRenamed && n.code !== src[id];
      // v33's S8GL6e4o never read the stored TO: hand it the run's own read
      if (id === "code_node_S8GL6e4o" && !(n.vars || {})["node:get_node_C64LC1sr.data.data"] && r.nodes.get_node_C64LC1sr) {
        put(ctx, "node:get_node_C64LC1sr.data.data", r.nodes.get_node_C64LC1sr.resp.data.data);
      }
      sb.__setNow(n.t0 || r.t0);
      sb.__setCtx(ctx);
      let mine;
      try {
        mine = sb.__run(id);
      } catch (e) {
        t.threw++;
        notes.push(`${r.env} ${r.id} ${id} THREW ${String(e).slice(0, 160)}`);
        continue;
      }
      let a = JSON.stringify(canon(mine));
      const b = JSON.stringify(canon(rec));
      // the platform takes the clock somewhere inside the node: retry at its end before calling it a difference
      if (a !== b && n.t1 && n.t1 !== n.t0) {
        sb.__setNow(n.t1);
        sb.__setCtx(Object.assign({}, ctx));
        try {
          const again = JSON.stringify(canon(sb.__run(id)));
          if (again === b) { a = again; t.clockAtEnd = (t.clockAtEnd || 0) + 1; }
        } catch (e) { /* keep the first answer */ }
      }
      if (a === b) t[older ? "olderSame" : "same"]++;
      else {
        t[older ? "olderDiff" : "diff"]++;
        const out = [];
        diffPaths(JSON.parse(a), JSON.parse(b), "", out);
        notes.push(`${r.env} ${r.id} ${id}${older ? " (older body)" : ""} exit ${r.exit}:\n      ` + out.join("\n      "));
      }
    }
  }
}
console.log("runs", runs);
for (const [id, t] of Object.entries(tally)) {
  console.log(`  ${id.padEnd(20)} same ${String(t.same).padStart(4)}  different ${String(t.diff).padStart(3)}  threw ${t.threw}  (token-renamed v33 body: ${t.renamed}${t.clockAtEnd ? ", clock at the node's end: " + t.clockAtEnd : ""})` +
    `   | older body: same ${t.olderSame}, different ${t.olderDiff}`);
}
for (const n of notes.slice(0, Number(process.env.SHOW || 40))) console.log("  " + n);
