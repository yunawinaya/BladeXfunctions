// In-process copy of the platform's code-node contract, for bodies lifted by lift/lift.py.
// Verified on recorded dev runs (harness rerun/convmap): a token is replaced by its value (null when it has none);
// a node keeps only its declared keys; an object declared `string` arrives as its JSON text; null-valued keys are
// dropped at every depth. Every __v() is a fresh copy, as every substituted literal is.
const __QUIET = { log() {}, error() {}, warn() {}, info() {}, debug() {} };
const __N = {};
let __CTX = {};

function __clone(v) {
  return v === undefined ? null : JSON.parse(JSON.stringify(v));
}

function __resolve(key) {
  const dot = key.indexOf(".", key.indexOf(":") + 1);
  let v = __CTX[dot < 0 ? key : key.slice(0, dot)];
  if (dot >= 0) {
    for (const p of key.slice(dot + 1).split(".")) {
      if (v === null || v === undefined) return null;
      v = v[p];
    }
  }
  return v === undefined ? null : v;
}

function __v(key) {
  const v = __resolve(key);
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
    o[name] = type === "string" && typeof v === "object" ? JSON.stringify(v) : v;
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
