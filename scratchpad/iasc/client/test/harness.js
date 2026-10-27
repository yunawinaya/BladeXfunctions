// Test harness for the Small Cycle IA client (copy of scratchpad/iav2/client/test/harness.js, adapted): a mock form `this` that
// records every platform call, a mock db (tables evaluated with where / filter / field / limit and a server clamp), mock
// localStorage, a DOM stub and a virtual clock. Handlers are compiled the way the platform bundle does: a rule event = its
// rules' js actions joined inside an async function; a js event = its func inside a plain function. triggerEvent(name, args)
// looks the event up by NAME. runWorkflow calls the callback, then settles the promise it returns.
// Added for the Small Cycle: openDialog / closeDialog, $confirm answered per title, and `fireOnChange`: a setData of a field
// (or a table cell) whose widget has an onChange event runs that event a tick later, as the platform does for row writes
// (iacqty01 "setData below re-enters this handler"); header fields are fired too, to prove the code tolerates it.
const fs = require("fs");
const path = require("path");

const IASC = path.resolve(__dirname, "../..");
const ROOT = path.resolve(IASC, "../..");
const readJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
// a test can be pointed at another build: SC_FORM (the OFF build), SC_FORM_ON, or a whole dry-run folder SC_OUT_DIR
const OUT = process.env.SC_OUT_DIR || path.join(ROOT, "Item Assembly & BOM/SmallCycle");
const OUT_ON = process.env.SC_OUT_DIR ? path.join(process.env.SC_OUT_DIR, "client_out/on") : path.join(IASC, "client/out/on");
const OUT_OFF = process.env.SC_OUT_DIR ? path.join(process.env.SC_OUT_DIR, "client_out/off") : path.join(IASC, "client/out/off");
const FILES = {
  form: process.env.SC_FORM || path.join(OUT_OFF, "IAform.json"),
  formOn: process.env.SC_FORM_ON || path.join(OUT_ON, "IAform.json"),
  formBase: path.join(IASC, "base/ia_form_v36.json"),
};
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const findModel = (n, m, key) => {
  if (n && typeof n === "object") {
    if (n.model === m && (!key || n.key === key)) return n;
    for (const v of Object.values(n)) {
      const r = findModel(v, m, key);
      if (r) return r;
    }
  }
  return null;
};
const byName = (doc, name) => doc.config.eventScript.find((e) => e.name === name);
const byKey = (doc, key) => doc.config.eventScript.find((e) => e.key === key);
const sourceOf = (e) => (e.type === "rule" ? (e.rules || []).filter((r) => r.action === "js").map((r) => r.options.func).join("\n") : e.func || "");

// leaf / branch filters as the client db sends them
const matches = (row, f) => {
  if (Array.isArray(f)) return f.every((x) => matches(row, x));
  if (f.type === "branch") return f.operator === "any" ? f.children.some((c) => matches(row, c)) : f.children.every((c) => matches(row, c));
  const v = row[f.prop];
  if (f.operator === "in") return (Array.isArray(f.value) ? f.value : [f.value]).map(String).indexOf(String(v)) >= 0;
  if (f.operator === "equal" || f.operator === "numberEqual") return String(v) === String(f.value);
  throw new Error("filter operator " + f.operator);
};
// a db over { collection: [rows] }: where / filter / doc select, field projects (id always kept), the server answers at most
// min(limit, clamp) rows, no limit = at most `defaultLimit`
const tableDb = (tables, o) => {
  o = o || {};
  return (name, q) => {
    let rows = (tables[name] || []).slice();
    if (q.doc !== undefined) rows = rows.filter((r) => String(r.id) === String(q.doc));
    if (q.where) rows = rows.filter((r) => Object.keys(q.where).every((k) => String(r[k]) === String(q.where[k])));
    if (q.filter) rows = rows.filter((r) => matches(r, q.filter));
    const cap = Math.min(q.limit === undefined ? o.defaultLimit || 100000 : q.limit, o.clamp || 100000);
    rows = rows.slice(0, cap);
    if (q.field) {
      const keep = ["id"].concat(String(q.field).split(","));
      rows = rows.map((r) => keep.reduce((m, k) => (k in r ? Object.assign(m, { [k]: r[k] }) : m), {}));
    }
    return { data: rows };
  };
};

// one scenario's world: virtual time, timers, the recorded calls
function world(opts) {
  opts = opts || {};
  const w = { now: 1800000000000, queue: [], trace: [], seq: 0 };
  w.setTimeout = (fn, ms) => {
    w.queue.push({ at: w.now + (ms || 0), seq: w.seq++, fn: fn });
    return w.seq;
  };
  w.Date = class extends Date {
    constructor(...a) {
      super(...(a.length ? a : [w.now]));
    }
    static now() {
      return w.now;
    }
  };
  w.rec = (name, ...args) => w.trace.push([name].concat(args.map(clone)));
  w.storage = opts.storage || {};
  w.localStorage = {
    getItem: (k) => {
      w.rec("localStorage.getItem", k);
      if (opts.storageThrows) throw new Error("blocked");
      return Object.prototype.hasOwnProperty.call(w.storage, k) ? w.storage[k] : null;
    },
    setItem: (k, v) => {
      w.rec("localStorage.setItem", k, v);
      if (opts.storageThrows) throw new Error("blocked");
      w.storage[k] = String(v);
    },
  };
  w.console = { log: () => {}, error: () => {}, warn: () => {} };
  // a seeded Math.random: two runs of one scenario (v36 and a build) draw the same numbers
  let seed = 20261020;
  w.Math = Object.assign(Object.create(Math), { random: () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) % 1000000) / 1000000 });
  w.reads = [];
  w.db = {
    collection: (name) => {
      const q = { collection: name };
      const chain = {
        where: (o) => ((q.where = clone(o)), chain),
        filter: (o) => ((q.filter = clone(o)), chain),
        field: (f) => ((q.field = f), chain),
        limit: (n) => ((q.limit = n), chain),
        doc: (id) => ((q.doc = id), chain),
        get: () => {
          w.rec("db.get", q);
          w.reads.push(q);
          if (opts.dbThrows && opts.dbThrows(name, q)) return new Promise((resolve, reject) => w.setTimeout(() => reject(new Error("db down")), 0));
          const r = opts.db ? opts.db(name, q) : { data: [] };
          // dbDelay(name, q) -> ms: a slower answer (to let a later run overtake an earlier one)
          return new Promise((resolve) => w.setTimeout(() => resolve(clone(r)), opts.dbDelay ? opts.dbDelay(name, q) || 0 : 0));
        },
        update: (o) => {
          w.rec("db.update", q, o);
          return new Promise((resolve) => w.setTimeout(() => resolve({}), 0));
        },
        add: (o) => {
          w.rec("db.add", q, o);
          return new Promise((resolve) => w.setTimeout(() => resolve({ id: "999" }), 0));
        },
      };
      return chain;
    },
  };
  w.document = {
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    createElement: () => ({ style: {} }),
    head: { appendChild: () => {} },
  };
  return w;
}

// compile a handler source as the platform does; the virtual clock and the mocks are bound in
function compile(w, code, isAsync) {
  return new Function("db", "Filter", "setTimeout", "Date", "console", "localStorage", "document", "Math", "return " + (isAsync ? "async " : "") + "function () {\n" + code + "\n};")(
    w.db, {}, w.setTimeout, w.Date, w.console, w.localStorage, w.document, w.Math);
}

const setPath = (obj, p, v) => {
  const parts = p.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] === undefined || cur[parts[i]] === null) cur[parts[i]] = /^[0-9]+$/.test(parts[i + 1]) ? [] : {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = v;
};
const getPath = (obj, p) => p.split(".").reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);

// model -> onChange event NAME for the header fields, and "<table>.<column>" -> name for table columns
const changeEvents = (doc) => {
  const names = {};
  doc.config.eventScript.forEach((e) => {
    names[e.key] = e.name;
  });
  const out = {};
  const walk = (n, table) => {
    if (Array.isArray(n)) return n.forEach((x) => walk(x, table));
    if (!n || typeof n !== "object") return;
    if (n.model && n.events && n.events.onChange && names[n.events.onChange]) out[(table ? table + "." : "") + n.model] = names[n.events.onChange];
    if (n.type === "table") (n.tableColumns || []).forEach((c) => walk(c, n.model));
    if (n.type === "dialog") return (n.list || []).forEach((x) => walk(x, ""));
    Object.keys(n).forEach((k) => {
      if (k !== "tableColumns" && k !== "options" && k !== "events") walk(n[k], table);
    });
  };
  walk(doc.list, "");
  return out;
};

// a form `this` over `doc` (the form JSON whose eventScript triggerEvent dispatches into); with stateful, setData writes the
// values that getValue / getValues read back. Every call made from inside sc_main (and what it triggers) is recorded with
// the prefix "sc:", so a comparison with v36 can drop exactly the Small Cycle calls.
function makeThis(w, doc, opts) {
  opts = opts || {};
  const values = opts.values || {};
  const onChange = opts.fireOnChange ? changeEvents(doc) : {};
  const tagOf = (me) => (me && me._tag) || "";
  const messages = (tag) => {
    const message = (x) => w.rec(tag + "$message", x);
    ["success", "error", "warning", "info"].forEach((k) => {
      message[k] = (x) => w.rec(tag + "$message." + k, x);
    });
    return message;
  };
  const self = {
    models: { _data: clone(opts.data || {}) },
    isAdd: !!opts.isAdd, isEdit: !!opts.isEdit, isView: !!opts.isView, isCopy: !!opts.isCopy,
    getValues() {
      w.rec(tagOf(this) + "getValues");
      if (opts.getValuesThrows) throw new Error("boom");
      return clone(values);
    },
    getValue(k) {
      w.rec(tagOf(this) + "getValue", k);
      return clone(getPath(values, k));
    },
    setData(o) {
      w.rec(tagOf(this) + "setData", o);
      if (opts.stateful) Object.keys(o).forEach((k) => setPath(values, k, clone(o[k])));
      Object.keys(o).forEach((k) => {
        const m = /^([a-z_0-9]+)\.([0-9]+)\.([a-z_0-9]+)$/.exec(k);
        const name = m ? onChange[m[1] + "." + m[3]] : onChange[k];
        if (!name) return;
        const args = m ? { value: clone(o[k]), rowIndex: Number(m[2]), row: clone(getPath(values, m[1] + "." + m[2])) } : { value: clone(o[k]) };
        w.setTimeout(() => self.triggerEvent.call(self, name, args), 0);
      });
      return Promise.resolve();
    },
    validate() {
      w.rec(tagOf(this) + "validate");
      return opts.invalid ? Promise.reject(opts.invalid) : Promise.resolve(true);
    },
    showLoading(t) { w.rec(tagOf(this) + "showLoading", t); },
    hideLoading() { w.rec(tagOf(this) + "hideLoading"); },
    hide(f) { w.rec(tagOf(this) + "hide", f); },
    display(f) { w.rec(tagOf(this) + "display", f); },
    disabled(f, v) { w.rec(tagOf(this) + "disabled", f, v); },
    refresh() { w.rec(tagOf(this) + "refresh"); },
    openDialog(k) {
      w.rec(tagOf(this) + "openDialog", k);
      return Promise.resolve();
    },
    closeDialog(k) {
      w.rec(tagOf(this) + "closeDialog", k);
      return Promise.resolve();
    },
    toView(o) {
      w.rec(tagOf(this) + "toView", o);
      return Promise.resolve();
    },
    getVarGlobal(k) {
      w.rec(tagOf(this) + "getVarGlobal", k);
      return (opts.globals || { deptParentId: "1001", nickname: "tester", firstLvDeptId: "1001" })[k];
    },
    getVarSystem(k) {
      w.rec(tagOf(this) + "getVarSystem", k);
      return (opts.system || { deptIds: "2002,2003", uid: "77" })[k];
    },
    getParamsVariables(k) {
      w.rec(tagOf(this) + "getParamsVariables", k);
      return (opts.params || {})[k];
    },
    onDropdownVisible() { return Promise.resolve({}); },
    getComponent(k) { return (opts.components || {})[k] || { options: {} }; },
    getOptionData() { return []; },
    setOptionData(k, v) { w.rec(tagOf(this) + "setOptionData", k, v === undefined ? null : v.length); },
    runWorkflow(id, params, ok, bad) {
      w.rec(tagOf(this) + "runWorkflow", id, params);
      const a = opts.answer ? opts.answer(id, params, w) : { data: { code: "200", message: "ok" } };
      const p = new Promise((resolve, reject) => {
        w.setTimeout(() => {
          if (a && a.reject !== undefined) {
            if (bad) bad(a.reject);
            reject(a.reject);
          } else {
            if (ok) ok(clone(a));
            resolve(clone(a));
          }
          // an answer may arrive later (a.__delay ms of virtual time): RES-01 MIN-06's row re-rendered while the form is dirty
        }, (a && a.__delay) || 0);
      });
      p.catch(() => {});
      return p;
    },
    triggerEvent(name, args) {
      w.rec(tagOf(this) + "triggerEvent", name, args === undefined ? "(no args)" : args);
      const e = byName(doc, name);
      if (!e) return undefined;
      // the Small Cycle handler's calls recorded "sc:", the output split's (os_main) "os:" (the base comparisons drop both)
      const target = name === "sc_main" ? tagged : name === "os_main" ? osTagged : tagOf(this) === "os:" ? osTagged : tagOf(this) ? tagged : self;
      return compile(w, sourceOf(e), e.type === "rule").call(target, args);
    },
    get $message() {
      return messages(tagOf(this));
    },
    $alert(m, t) {
      w.rec(tagOf(this) + "$alert", m, t);
      return opts.alertRejects ? Promise.reject(new Error("closed")) : Promise.resolve("confirm");
    },
    $confirm(m, t) {
      w.rec(tagOf(this) + "$confirm", t, m);
      const answer = opts.confirm ? opts.confirm(m, t) : "confirm";
      return answer === "confirm" ? Promise.resolve("confirm") : Promise.reject(new Error("cancel"));
    },
    parentGenerateForm: { $refs: { SuPageDialogRef: { hide: () => w.rec("dialog.hide") } }, refresh: () => w.rec("list.refresh") },
  };
  const tagged = Object.create(self);
  tagged._tag = "sc:";
  const osTagged = Object.create(self);
  osTagged._tag = "os:";
  self.values = values;
  return self;
}

// run the event loop until nothing is left (virtual time jumps to the next timer); `limit` guards a runaway loop
async function drain(w, limit) {
  for (let i = 0; i < (limit || 40000); i++) {
    for (let k = 0; k < 8; k++) await new Promise((r) => setImmediate(r));
    if (!w.queue.length) return;
    w.queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
    const next = w.queue.shift();
    w.now = Math.max(w.now, next.at);
    try {
      next.fn();
    } catch (e) {
      w.rec("uncaught", String(e && e.message));
      uncaught.push(String(e && e.stack).slice(0, 400));
    }
  }
  throw new Error("drain limit");
}

// run one handler (by eventScript entry) with these arguments
async function fire(w, entry, self, args) {
  const fn = compile(w, sourceOf(entry), entry.type === "rule");
  fn.call(self, args === undefined ? { field: "button_x", fieldNode: "button_x", currentRef: {}, $eventArgs: [] } : args);
  await drain(w);
  return w.trace;
}

let fails = 0;
let total = 0;
const uncaught = [];
process.on("unhandledRejection", (e) => uncaught.push("unhandled rejection: " + String(e && (e.stack || e.message || e)).slice(0, 400)));
const check = (what, ok, detail) => {
  total++;
  if (!ok) {
    fails++;
    console.log("FAIL " + what + (detail === undefined ? "" : " " + JSON.stringify(detail).slice(0, 1500)));
  }
};
let finished = false;
process.on("exit", (code) => {
  if (!finished && code === 0) {
    console.log("FAIL the test ended without its summary");
    process.exitCode = 1;
  }
});
const done = (name) => {
  finished = true;
  check("no uncaught error in any scenario", uncaught.length === 0, uncaught.slice(0, 3));
  console.log(name + ": " + (total - fails) + "/" + total + " passed");
  process.exit(fails ? 1 : 0);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const SC_KEYS = ["source_so_id", "source_so_line_id", "source_so_context_json", "bom_consumption_mode", "source_bom_id", "bom_snapshot_json", "planned_output_qty"];
const legacyTrace = (trace) => trace.filter((t) => !/^(sc|os):/.test(t[0]) && !(t[0] === "getValue" && SC_KEYS.indexOf(t[1]) >= 0) && !(t[0] === "triggerEvent" &&
  (t[1] === "sc_main" || t[1] === "os_main")));

// a built Small Cycle script with its switch and workflow ids set: on = true / false, wf = { SO_IA_PROJECTION, IA_SC_RELINK }
const SC_SWITCH_RE = /const SC_ENABLED = (true|false);/g;
const SC_ID_RE = /"([0-9]+)"([^"\n]*\/\/ (SO_IA_PROJECTION|IA_SC_RELINK|SO_LINKED_IAS_PAGE|IA_HOLD))$/gm;
const SC_TEST_IDS = { SO_IA_PROJECTION: "9101", IA_SC_RELINK: "9102", SO_LINKED_IAS_PAGE: "9103", IA_HOLD: "9104" };
const SC_OFF_IDS = { SO_IA_PROJECTION: "0", IA_SC_RELINK: "0", SO_LINKED_IAS_PAGE: "0", IA_HOLD: "0" };
const scVariantCode = (code, on, wf) =>
  code.replace(SC_SWITCH_RE, () => "const SC_ENABLED = " + (on ? "true" : "false") + ";").replace(SC_ID_RE, (m, id, rest, which) => '"' + (wf || SC_TEST_IDS)[which] + '"' + rest);
// the whole form with every js event's switch / ids set
const scVariant = (doc, on, wf) => {
  const d = clone(doc);
  d.config.eventScript.forEach((e) => {
    if (e.func) e.func = scVariantCode(e.func, on, wf);
    (e.rules || []).forEach((r) => {
      if (r.options && r.options.func) r.options.func = scVariantCode(r.options.func, on, wf);
    });
  });
  return d;
};
// RES-01: the raw-material hold switch in every built script that has one (the build ships it false); n = how many were set
const RES_SWITCH_RE = /const RES_ENABLED = (true|false);/g;
const resVariant = (doc, on) => {
  const d = clone(doc);
  let n = 0;
  const set = (code) => code.replace(RES_SWITCH_RE, () => (n++, "const RES_ENABLED = " + (on ? "true" : "false") + ";"));
  d.config.eventScript.forEach((e) => {
    if (e.func) e.func = set(e.func);
    (e.rules || []).forEach((r) => {
      if (r.options && r.options.func) r.options.func = set(r.options.func);
    });
  });
  d.resSwitches = n;
  return d;
};
const IDS = readJSON(process.env.SC_IDS || path.join(IASC, "ids.json"));

module.exports = { IASC, ROOT, OUT, FILES, IDS, SC_TEST_IDS, SC_OFF_IDS, readJSON, clone, findModel, byName, byKey, sourceOf, matches, tableDb, world,
  compile, makeThis, changeEvents, drain, fire, check, done, same, scVariant, scVariantCode, resVariant, getPath, setPath, SC_KEYS, legacyTrace };
