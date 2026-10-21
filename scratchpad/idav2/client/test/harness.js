// Test harness for package D (copy of tpl/iav2/client/test/harness.js, IDA paths / switches): a mock form / page `this` that records every
// platform call, a mock db (a function, or tables evaluated with where / filter / field / limit and a server clamp), mock
// localStorage, a DOM stub and a virtual clock. Handlers are compiled the way the platform bundle does
// (tpl/sav2/client/evidence/triggerEvent_rule_event.txt): a rule event = its rules' js actions joined inside an async
// function; a js event = its func inside a plain function. triggerEvent(name, args) looks the event up by NAME. runWorkflow
// calls the callback, then settles the promise it returns (rejecting after an error callback, as the platform does).
const fs = require("fs");
const path = require("path");

const IDAV2 = path.resolve(__dirname, "../..");
const ROOT = path.resolve(IDAV2, "../..");
const readJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
// a test can be pointed at another build: IDA_FORM / IDA_LIST, or a whole dry-run output folder IDA_OUT_DIR (build_client.py)
const OUT = process.env.IDA_OUT_DIR || path.join(ROOT, "Item Disassembly/AsyncV2");
const OUT_ON = process.env.IDA_OUT_DIR ? path.join(process.env.IDA_OUT_DIR, "client_out/on") : path.join(IDAV2, "client/out/on");
const FILES = {
  form: process.env.IDA_FORM || path.join(OUT, "IDAform.json"),
  list: process.env.IDA_LIST || path.join(OUT, "IDAlistPage.json"),
  formOn: path.join(OUT_ON, "IDAform.json"),
  listOn: path.join(OUT_ON, "IDAlistPage.json"),
  formBase: path.join(IDAV2, "base/ida_form_v35.json"),
  listBase: path.join(IDAV2, "base/ida_list_v17d.json"),
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
          return new Promise((resolve) => w.setTimeout(() => resolve(clone(r)), 0));
        },
        update: (o) => {
          w.rec("db.update", q, o);
          // a stateful test db sees its own writes
          if (opts.onUpdate) opts.onUpdate(name, q, clone(o));
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
  return new Function("db", "Filter", "setTimeout", "Date", "console", "localStorage", "document", "return " + (isAsync ? "async " : "") + "function () {\n" + code + "\n};")(
    w.db, {}, w.setTimeout, w.Date, w.console, w.localStorage, w.document);
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

// a form `this` over `doc` (the form JSON whose eventScript triggerEvent dispatches into); with stateful, setData writes the
// values that getValue / getValues read back
function makeThis(w, doc, opts) {
  opts = opts || {};
  const values = opts.values || {};
  const message = (x) => w.rec("$message", x);
  ["success", "error", "warning", "info"].forEach((k) => {
    message[k] = (x) => w.rec("$message." + k, x);
  });
  const self = {
    models: { _data: clone(opts.data || {}) },
    isAdd: !!opts.isAdd, isEdit: !!opts.isEdit, isView: !!opts.isView, isCopy: !!opts.isCopy,
    getValues: () => {
      w.rec("getValues");
      if (opts.getValuesThrows) throw new Error("boom");
      return clone(values);
    },
    getValue: (k) => (w.rec("getValue", k), clone(getPath(values, k))),
    setData: (o) => {
      w.rec("setData", o);
      if (opts.stateful) Object.keys(o).forEach((k) => setPath(values, k, clone(o[k])));
      return Promise.resolve();
    },
    validate: () => {
      w.rec("validate");
      return opts.invalid ? Promise.reject(opts.invalid) : Promise.resolve(true);
    },
    showLoading: (t) => w.rec("showLoading", t),
    hideLoading: () => w.rec("hideLoading"),
    hide: (f) => w.rec("hide", f),
    display: (f) => w.rec("display", f),
    disabled: (f, v) => w.rec("disabled", f, v),
    refresh: () => w.rec("refresh"),
    closeDialog: (k) => w.rec("closeDialog", k),
    getVarGlobal: (k) => (w.rec("getVarGlobal", k), (opts.globals || { deptParentId: "1001", nickname: "tester", firstLvDeptId: "1001" })[k]),
    getVarSystem: (k) => (w.rec("getVarSystem", k), (opts.system || { deptIds: "2002,2003" })[k]),
    getParamsVariables: (k) => (opts.params || {})[k],
    onDropdownVisible: () => Promise.resolve({}),
    getComponent: (k) => (opts.components || {})[k] || { options: {} },
    getOptionData: () => [],
    setOptionData: (k, v) => w.rec("setOptionData", k, v === undefined ? null : v.length),
    runWorkflow: (id, params, ok, bad) => {
      w.rec("runWorkflow", id, params);
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
        }, 0);
      });
      p.catch(() => {});
      return p;
    },
    triggerEvent: (name, args) => {
      w.rec("triggerEvent", name, args === undefined ? "(no args)" : args);
      const e = byName(doc, name);
      if (!e) return undefined;
      return compile(w, sourceOf(e), e.type === "rule").call(self, args);
    },
    $message: message,
    $alert: (m, t) => (w.rec("$alert", m, t), opts.alertRejects ? Promise.reject(new Error("closed")) : Promise.resolve("confirm")),
    $confirm: (m, t) => {
      w.rec("$confirm", t);
      const answer = opts.confirm ? opts.confirm(m, t) : "confirm";
      return answer === "confirm" ? Promise.resolve("confirm") : Promise.reject(new Error("cancel"));
    },
    parentGenerateForm: { $refs: { SuPageDialogRef: { hide: () => w.rec("dialog.hide") } }, refresh: () => w.rec("list.refresh") },
  };
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

// a built script with its switches and workflow ids set, whatever state it ships in: sw = { master, complete, completePost }
// (true / false), wf = { IDA_V2_SUBMIT, IDA_V2_WORKER }
const SWITCH_RE = /const (ASYNC_IDA_ENABLED|IDA_BG_ENABLED) = (true|false);/g;
const ACTIONS_RE = /const IDA_V2_ACTIONS = \{ COMPLETE: (true|false), COMPLETE_POST: (true|false) \};/g;
const ID_RE = /"([0-9]+)"([^"\n]*\/\/ (IDA_V2_SUBMIT|IDA_V2_WORKER))$/gm;
const OFF_IDS = { IDA_V2_SUBMIT: "0", IDA_V2_WORKER: "0" };
const TEST_IDS = { IDA_V2_SUBMIT: "9001", IDA_V2_WORKER: "9002" };
const variant = (code, sw, wf) => {
  const s = Object.assign({ master: false, complete: true, completePost: true }, sw || {});
  const n = (code.match(SWITCH_RE) || []).length + (code.match(ID_RE) || []).length;
  if (!n) throw new Error("variant: no switch / workflow id in the script");
  return code
    .replace(SWITCH_RE, (m, name) => "const " + name + " = " + s.master + ";")
    .replace(ACTIONS_RE, () => "const IDA_V2_ACTIONS = { COMPLETE: " + s.complete + ", COMPLETE_POST: " + s.completePost + " };")
    .replace(ID_RE, (m, id, rest, which) => '"' + (wf || OFF_IDS)[which] + '"' + rest);
};
// the state a built script ships in: { switches: {name: bool}, actions, ids: {NAME: id} }
const shippedState = (code) => {
  const switches = {};
  for (const m of code.matchAll(SWITCH_RE)) switches[m[1]] = m[2] === "true";
  const a = code.match(/const IDA_V2_ACTIONS = \{ COMPLETE: (true|false), COMPLETE_POST: (true|false) \};/);
  const ids = {};
  for (const m of code.matchAll(ID_RE)) ids[m[3]] = m[1];
  return { switches: switches, actions: a ? { COMPLETE: a[1] === "true", COMPLETE_POST: a[2] === "true" } : null, ids: ids };
};
const IDS = readJSON(process.env.IDA_IDS || path.join(IDAV2, "ids.json"));
// the state the repo build ships in: OFF until the integration publishes it ON (IDA_EXPECT_ON=1: every switch on)
const EXPECT_ON = process.env.IDA_EXPECT_ON === "1";

module.exports = { IDAV2, ROOT, OUT, FILES, IDS, EXPECT_ON, OFF_IDS, TEST_IDS, readJSON, clone, findModel, byName, byKey, sourceOf, matches, tableDb, world, compile, makeThis,
  drain, fire, check, done, same, variant, shippedState, getPath };
