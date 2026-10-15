// In-process copy of the platform's code-node contract, for bodies lifted by lift/lift.py (copy of scratchpad/pwv2/lift).
// A token is replaced by its value (null when it has none); a node keeps only its declared keys; an object declared
// `string` arrives as its JSON text; a number declared `int` is truncated toward zero, a boolean declared `int` arrives as
// 1 / 0; null-valued keys are dropped at every depth. Every __v() is a fresh copy, as every substituted literal is.
// A read V2 answers in full is set as __Uncapped(rows): __v hands it on as an empty array whose iteration yields every row,
// so grRvBuild's fetch ceiling (rows.length >= 1000) stays inert while its for...of loops see all rows (lift.py checks
// those reads are used no other way).
const __QUIET = { log() {}, error() {}, warn() {}, info() {}, debug() {} };
const __N = {};
let __CTX = {};

function __clone(v) {
  return v === undefined ? null : JSON.parse(JSON.stringify(v));
}

function __Uncapped(rows) {
  this.rows = rows;
}

function __rowsView(rows) {
  const view = [];
  Object.defineProperty(view, Symbol.iterator, { value: () => rows[Symbol.iterator]() });
  return view;
}

function __resolve(key) {
  const dot = key.indexOf(".", key.indexOf(":") + 1);
  let v = __CTX[dot < 0 ? key : key.slice(0, dot)];
  if (dot >= 0) {
    for (const p of key.slice(dot + 1).split(".")) {
      if (v === null || v === undefined || v instanceof __Uncapped) return null;
      v = v[p];
    }
  }
  return v === undefined ? null : v;
}

function __v(key) {
  const v = __resolve(key);
  if (v instanceof __Uncapped) return __rowsView(__clone(v.rows));
  return v === null ? null : __clone(v);
}

function __strip(v) {
  if (Array.isArray(v)) return v.map(__strip);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) if (v[k] !== null && v[k] !== undefined) o[k] = __strip(v[k]);
    return o;
  }
  return v;
}

function __platformOut(raw, decl) {
  if (raw === null || raw === undefined || typeof raw !== "object") return {};
  const r = JSON.parse(JSON.stringify(raw));
  const o = {};
  for (const [name, type] of decl) {
    const v = r[name];
    if (v === null || v === undefined) continue;
    if (type === "string" && typeof v === "object") o[name] = JSON.stringify(v);
    else if (type === "int" && typeof v === "number") o[name] = Math.trunc(v);
    else if (type === "int" && typeof v === "boolean") o[name] = v ? 1 : 0;
    else o[name] = v;
  }
  return __strip(o);
}

function __run(id) {
  const n = __N[id];
  if (!n) throw new Error("not lifted: " + id);
  const out = __platformOut(n.fn(), n.decl);
  __CTX["node:" + id] = { data: out };
  return out;
}

function __set(key, value) {
  __CTX[key] = value;
}

function __withContext(ctx, fn) {
  const saved = __CTX;
  __CTX = ctx;
  try {
    return fn();
  } finally {
    __CTX = saved;
  }
}
