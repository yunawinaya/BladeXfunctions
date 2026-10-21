// Runs one payload through two workflow versions (each against its own fresh world) and reports every difference in the
// outcome and in what was written (final PI / PO / GR state).
"use strict";
const { Engine } = require("./engine.js");
const { clone } = require("./world.js");

const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined && v[k] !== null) o[k] = canon(v[k]);
    return o;
  }
  if (typeof v === "number" && Number.isFinite(v)) return Number(v.toPrecision(15));
  return v;
};
const J = (v) => JSON.stringify(canon(v));

function runOnce(doc, makeWorld, params, opts) {
  const w = makeWorld();
  const e = new Engine(doc, w, opts || {});
  let r;
  try {
    r = e.run(clone(params));
  } catch (err) {
    return { crash: String(err.message || err).split("\n")[0], world: w, sizes: {} };
  }
  const o = r.outcome || {};
  return {
    outcome: { code: o.code, msg: o.msg, data: o.data },
    state: { pi: w.pi, po: w.po, gr: w.gr },
    writes: r.writes.filter((x) => x.kind !== "workflow"),
    sizes: e.sizes,
    world: w,
    order: r.order,
  };
}

function diff(a, b, path, out) {
  if (out.length > 6) return out;
  const ja = J(a);
  const jb = J(b);
  if (ja === jb) return out;
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) === !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) diff(a[k], b[k], path + "." + k, out);
    if (Array.isArray(a) && a.length !== b.length) out.push(path + ".length " + a.length + " vs " + b.length);
    return out;
  }
  out.push(path + ": " + ja.slice(0, 200) + " vs " + jb.slice(0, 200));
  return out;
}

function compare(oldDoc, newDoc, makeWorld, params) {
  const a = runOnce(oldDoc, makeWorld, params);
  const b = runOnce(newDoc, makeWorld, params);
  const problems = [];
  if (a.crash || b.crash) {
    if (!(a.crash && b.crash)) problems.push("crash: old=" + (a.crash || "-") + " new=" + (b.crash || "-"));
    return { same: problems.length === 0, problems, a, b };
  }
  diff(a.outcome, b.outcome, "outcome", problems);
  diff(a.state, b.state, "state", problems);
  return { same: problems.length === 0, problems, a, b };
}

module.exports = { compare, runOnce, canon, J };
