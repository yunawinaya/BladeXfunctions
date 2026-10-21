// Revert V2 test harness: the lifted classic (revert/lift: runtime.js + lifted_revert.js) and the PREPARE / SUBMIT helpers loaded
// into one vm sandbox, optionally with a frozen clock (a recorded run's time, so code_node_iaRvBuild's docDate matches), plus the
// recorded-run fixtures (test/revert/fetch_runs.py JSONL, kept OUTSIDE the repo: customer data). Copy of tpl/grrv/test/_harness.js'
// sandbox / platform rules for this package's files.
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const IAV2 = path.join(__dirname, "..", "..");
const read = (f) => fs.readFileSync(path.join(IAV2, f), "utf8");
const strip = (t) => t.split("\n").filter((l) => !l.startsWith("if (typeof module")).join("\n");
const LIFT = ["revert/lift/runtime.js", "revert/lift/lifted_revert.js"];
// + RES-01 R5's shared core (resRevertAdds, inlined into the plan node by build_revert.py)
const SHARED = ["code/shared/ia_common.js", "code/shared/fingerprint.js", "code/shared/movekey.js", "../iasc/res01/code/shared/revert.js"];

// clock: epoch ms for new Date() / Date.now(), or undefined for the real clock
function sandbox(clock) {
  const sb = { JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Symbol, console: { log() {}, error() {} } };
  if (clock !== undefined) {
    const RealDate = Date;
    const FakeDate = function (...a) {
      if (!(this instanceof FakeDate)) return new RealDate(clock).toString();
      return a.length ? new RealDate(...a) : new RealDate(clock);
    };
    FakeDate.now = () => clock;
    FakeDate.parse = RealDate.parse;
    FakeDate.UTC = RealDate.UTC;
    FakeDate.prototype = RealDate.prototype;
    sb.Date = FakeDate;
  } else sb.Date = Date;
  vm.createContext(sb);
  return sb;
}

// the lifted classic + shared helpers + the given package files, as one script in a fresh sandbox; `names` = the top-level
// functions / constants to expose on the sandbox (a script's const is not a global); returns the sandbox
function load(files, clock, names) {
  const sb = sandbox(clock);
  const text = LIFT.concat(SHARED).map((f) => strip(read(f))).concat((files || []).map((f) => strip(read(f)))).join("\n");
  const out = ["__set", "__run", "__N", "__withContext", "__Uncapped"].concat(names || []).map((n) => "this." + n + " = " + n + ";").join(" ");
  vm.runInContext(text + "\n" + out, sb);
  return sb;
}

// a step file without its platform tail (the lines from the first `const res = ` / `const guard = ` / a {{token}} on)
const stepBody = (f) => {
  const lines = strip(read(f)).split("\n");
  const at = lines.findIndex((l) => /^const (res|guard|e|eng|si|own|mid|plan|pick|it|iarv[A-Za-z]*Res|iarvTrack) = /.test(l) || /^let iarv[A-Za-z]*Res;/.test(l) || l.indexOf("{{") >= 0);
  return (at < 0 ? lines : lines.slice(0, at)).join("\n");
};
// step functions (shared helpers + the given files, each without its platform tail) in a fresh sandbox, `names` exposed
function loadSteps(files, names, clock, withLift) {
  const sb = sandbox(clock);
  const head = (withLift ? LIFT : []).concat(SHARED).map((f) => strip(read(f)));
  const text = head.concat(files.map(stepBody)).join("\n");
  if (/\{\{/.test(text)) throw new Error("a platform token is left in " + files.join(", "));
  vm.runInContext(text + "\n" + names.map((n) => "this." + n + " = " + n + ";").join(" "), sb);
  return sb;
}

// a value handed to a lifted node through the sandbox (deep copy: no shared objects across the vm boundary)
const intoBox = (sb, v) => (v === undefined ? undefined : vm.runInContext("(" + JSON.stringify(v) + ")", sb));
const fromBox = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// run one lifted node with the given token values (key = the token text, e.g. "node:sql_node_iaRvMovs.data")
function runLifted(sb, id, tokens) {
  const ctx = intoBox(sb, {});
  for (const [k, v] of Object.entries(tokens)) {
    const dot = k.indexOf(".", k.indexOf(":") + 1);
    const head = dot < 0 ? k : k.slice(0, dot);
    const tail = dot < 0 ? [] : k.slice(dot + 1).split(".");
    // rebuild the nested value the token path addresses ({ data: { data: v } } for node:x.data.data)
    let cur = ctx;
    let key = head;
    for (const p of tail) {
      if (cur[key] === undefined || cur[key] === null || typeof cur[key] !== "object") cur[key] = intoBox(sb, {});
      cur = cur[key];
      key = p;
    }
    cur[key] = intoBox(sb, v);
  }
  return fromBox(sb.__withContext(ctx, () => sb.__run(id)));
}

// 16+ digit integers as their exact digit strings (the platform's ids)
const parseBig = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
// the recorded classic IA_REVERT runs (test/revert/fetch_runs.py): prod-derived, so OUTSIDE the repo (CONTRACT.md ruling 8)
const FIXTURES = "/Users/yunawinaya/Documents/ASC-dev/iav2-fixtures/f";
function runs(dir) {
  const out = [];
  const at = dir || FIXTURES;
  for (const env of ["prod", "dev"]) {
    const f = path.join(at, "runs_" + env + ".jsonl");
    if (!fs.existsSync(f)) {
      console.log("NOTICE: " + f + " is absent - its " + env + " checks are skipped (re-pull: python3 scratchpad/iav2/test/revert/fetch_runs.py --" + env + ")");
      continue;
    }
    for (const line of fs.readFileSync(f, "utf8").split("\n")) if (line.trim()) out.push(parseBig(line));
  }
  return out;
}

// canonical JSON: keys sorted, numbers as JSON prints them (a float's text, not its type)
function canon(v) {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
}
// the first path where two values differ ("" when equal)
function diff(a, b, at) {
  const p = at || "$";
  if (canon(a) === canon(b)) return "";
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return p + ".length " + a.length + " vs " + b.length;
    for (let i = 0; i < a.length; i++) {
      const d = diff(a[i], b[i], p + "[" + i + "]");
      if (d) return d;
    }
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).sort();
    for (const k of keys) {
      if (!(k in a) || !(k in b)) return p + "." + k + ": only on the " + (k in a ? "left" : "right") + " (" + JSON.stringify(k in a ? a[k] : b[k]) + ")";
      const d = diff(a[k], b[k], p + "." + k);
      if (d) return d;
    }
  }
  return p + ": " + JSON.stringify(a).slice(0, 200) + " vs " + JSON.stringify(b).slice(0, 200);
}

let fails = 0;
let passes = 0;
const ok = (cond, what, extra) => {
  if (cond) passes++;
  else {
    fails++;
    console.log("FAIL", what, extra === undefined ? "" : (typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 900));
  }
  return cond;
};
const done = (label) => {
  console.log(label + ": " + passes + " passed, " + fails + " failed");
  process.exit(fails ? 1 : 0);
};

module.exports = { IAV2, FIXTURES, read, strip, stepBody, loadSteps, sandbox, load, intoBox, fromBox, runLifted, parseBig, runs, canon, diff, ok, done };
