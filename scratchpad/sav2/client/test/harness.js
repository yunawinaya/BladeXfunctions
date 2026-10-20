// Test harness for package D: a mock form/page `this` that records every platform call, a mock db and localStorage, and a
// virtual clock. Handlers are compiled the way the platform bundle does (generateForm.loadEvents): a rule event = its rules'
// js actions joined (ft$5 / lt$7: a js action is its options.func verbatim) inside an async function; a js event = its func
// inside a plain function. triggerEvent(name, args) looks the event up by eventScript NAME and calls it with args, as
// generateForm.triggerEvent does (client/evidence/triggerEvent_rule_event.txt).
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../../..");
const SAV2 = path.resolve(__dirname, "../..");
const readJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const FILES = {
  // a test can be pointed at another build (mutation checks): SA_FORM / SA_LIST / SC_FORM / SC_LIST
  saForm: process.env.SA_FORM || path.join(ROOT, "Stock Adjustment/AsyncV2/SAform.json"),
  saList: process.env.SA_LIST || path.join(ROOT, "Stock Adjustment/AsyncV2/SAlistPage.json"),
  scForm: process.env.SC_FORM || path.join(ROOT, "Stock Count/AsyncV2/SCform.json"),
  scList: process.env.SC_LIST || path.join(ROOT, "Stock Count/AsyncV2/SClistPage.json"),
  saFormBase: path.join(SAV2, "base/sa_form_v313.json"),
  saListBase: path.join(SAV2, "base/sa_list_v57.json"),
  scFormBase: path.join(SAV2, "base/sc_form_v497.json"),
  scListBase: path.join(SAV2, "base/sc_list_v38.json"),
};
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const findModel = (n, m) => {
  if (n && typeof n === "object") {
    if (n.model === m) return n;
    for (const v of Object.values(n)) {
      const r = findModel(v, m);
      if (r) return r;
    }
  }
  return null;
};
const byName = (doc, name) => doc.config.eventScript.find((e) => e.name === name);
const byKey = (doc, key) => doc.config.eventScript.find((e) => e.key === key);
const sourceOf = (e) => (e.type === "rule" ? (e.rules || []).filter((r) => r.action === "js").map((r) => r.options.func).join("\n") : e.func || "");

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
  // db: every read and write is recorded; reads answer from opts.db(collection, query)
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
          const r = opts.db ? opts.db(name, q) : { data: [] };
          return new Promise((resolve) => w.setTimeout(() => resolve(clone(r)), 0));
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
  return w;
}

// compile a handler source as the platform does; the virtual clock and the mocks are bound in
function compile(w, code, isAsync) {
  const document = { querySelectorAll: () => [], getElementById: () => null };
  return new Function("db", "Filter", "setTimeout", "Date", "console", "localStorage", "document", "return " + (isAsync ? "async " : "") + "function () {\n" + code + "\n};")(
    w.db, {}, w.setTimeout, w.Date, w.console, w.localStorage, document);
}

// a form `this` over `doc` (the form JSON whose eventScript triggerEvent dispatches into)
function makeThis(w, doc, opts) {
  opts = opts || {};
  const values = opts.values || {};
  const self = {
    models: { _data: clone(opts.data || {}) },
    isAdd: !!opts.isAdd, isEdit: !!opts.isEdit, isView: !!opts.isView, isCopy: !!opts.isCopy,
    getValues: () => {
      w.rec("getValues");
      if (opts.getValuesThrows) throw new Error("boom");
      return clone(values);
    },
    getValue: (k) => (w.rec("getValue", k), clone(values[k])),
    setData: (o) => w.rec("setData", o),
    showLoading: (t) => w.rec("showLoading", t),
    hideLoading: () => w.rec("hideLoading"),
    hide: (f) => w.rec("hide", f),
    display: (f) => w.rec("display", f),
    disabled: (f, v) => w.rec("disabled", f, v),
    refresh: () => w.rec("refresh"),
    getVarGlobal: (k) => (w.rec("getVarGlobal", k), (opts.globals || { deptParentId: "1001", nickname: "tester", firstLvDeptId: "1001" })[k]),
    getVarSystem: (k) => (w.rec("getVarSystem", k), (opts.system || { deptIds: "2002,2003" })[k]),
    getParamsVariables: (k) => (opts.params || {})[k],
    onDropdownVisible: () => Promise.resolve({}),
    getComponent: (k) => (opts.components || {})[k] || { options: {} },
    getOptionData: () => [],
    setOptionData: () => {},
    runWorkflow: (id, params, ok, bad) => {
      w.rec("runWorkflow", id, params);
      const a = opts.answer ? opts.answer(id, params, w) : { data: { code: "200", message: "ok" } };
      w.setTimeout(() => {
        if (a && a.reject) {
          if (bad) bad(a.reject);
        } else if (ok) ok(clone(a));
      }, 0);
      return undefined;
    },
    triggerEvent: (name, args) => {
      w.rec("triggerEvent", name, args === undefined ? "(no args)" : args);
      const e = byName(doc, name);
      if (!e) return undefined;
      return compile(w, sourceOf(e), e.type === "rule").call(self, args);
    },
    $message: ["success", "error", "warning", "info"].reduce((m, k) => Object.assign(m, { [k]: (x) => w.rec("$message." + k, x) }), {}),
    $alert: (m, t) => (w.rec("$alert", m, t), opts.alertRejects ? Promise.reject(new Error("closed")) : Promise.resolve("confirm")),
    $confirm: (m, t) => {
      w.rec("$confirm", t);
      const answer = opts.confirm ? opts.confirm(m, t) : "confirm";
      return answer === "confirm" ? Promise.resolve("confirm") : Promise.reject(new Error("cancel"));
    },
    parentGenerateForm: { $refs: { SuPageDialogRef: { hide: () => w.rec("dialog.hide") } }, refresh: () => w.rec("list.refresh") },
  };
  return self;
}

// run the event loop until nothing is left (virtual time jumps to the next timer); `limit` guards a runaway loop
async function drain(w, limit) {
  for (let i = 0; i < (limit || 20000); i++) {
    for (let k = 0; k < 6; k++) await new Promise((r) => setImmediate(r));
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

// run one handler (by eventScript entry) as a click of `field`
async function click(w, doc, entry, self, field) {
  const fn = compile(w, sourceOf(entry), entry.type === "rule");
  fn.call(self, { field: field || "button_x", fieldNode: field || "button_x", currentRef: {}, $eventArgs: [] });
  await drain(w);
  return w.trace;
}

let fails = 0;
let total = 0;
const uncaught = [];
const check = (what, ok, detail) => {
  total++;
  if (!ok) {
    fails++;
    console.log("FAIL " + what + (detail === undefined ? "" : " " + JSON.stringify(detail).slice(0, 1500)));
  }
};
const done = (name) => {
  check("no uncaught error in any scenario", uncaught.length === 0, uncaught.slice(0, 3));
  console.log(name + ": " + (total - fails) + "/" + total + " passed");
  process.exit(fails ? 1 : 0);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const replaceOnce = (text, a, b) => {
  const n = text.split(a).length - 1;
  if (n !== 1) throw new Error("replaceOnce: " + n + " x " + a);
  return text.replace(a, b);
};

// a built script with its switches and workflow ids set, whatever state it ships in: variant(code, false, OFF_IDS) is the
// fall-through variant (switches false, ids "0"); variant(code, true, { SUBMIT, WORKER }) a V2 variant
const SWITCH_RE = /const (ASYNC_SA_ENABLED|ASYNC_SC_REVIEW_ENABLED|SA_BG_ENABLED|SCR_BG_ENABLED) = (true|false);/g;
const ID_RE = /(SUBMIT: |STATUS: |WORKER: |const WORKER = )"([0-9]+)"([,;] \/\/ SA_V2_(SUBMIT|WORKER))/g;
const OFF_IDS = { SUBMIT: "0", WORKER: "0" };
const variant = (code, on, wfIds) => {
  const switches = (code.match(SWITCH_RE) || []).length;
  const idRefs = (code.match(ID_RE) || []).length;
  if (switches < 1 || idRefs < 1) throw new Error("variant: no switch / workflow id in the script (" + switches + "/" + idRefs + ")");
  return code.replace(SWITCH_RE, (m, name) => "const " + name + " = " + (on ? "true" : "false") + ";")
    .replace(ID_RE, (m, pre, id, post, which) => pre + '"' + (which === "SUBMIT" ? wfIds.SUBMIT : wfIds.WORKER) + '"' + post);
};
// the shipped state of a built script: { on, SUBMIT, WORKER } (null when a script mixes states)
const shippedState = (code) => {
  const sw = Array.from(code.matchAll(SWITCH_RE)).map((m) => m[2]);
  const ids = Array.from(code.matchAll(ID_RE)).map((m) => [m[4], m[2]]);
  const sub = ids.filter((x) => x[0] === "SUBMIT").map((x) => x[1]);
  const wrk = ids.filter((x) => x[0] === "WORKER").map((x) => x[1]);
  if (!sw.length || new Set(sw).size !== 1 || new Set(sub).size > 1 || new Set(wrk).size !== 1) return null;
  return { on: sw[0] === "true", SUBMIT: sub[0] || "", WORKER: wrk[0] };
};
const IDS = readJSON(path.join(SAV2, "ids.json"));
// Phase C: the SC base with the 2,000-line blocks applied as build_client.py does (its anchors, re-derived here): the reference
// for call-for-call mounted traces; test_sc_2k.js checks the blocks themselves against the real base on a stateful form
const SC2K = [
  ['  setTimeout(async () => {\n    if (scStatus === "In Progress") {\n      const tableStockCount = await this.getValue("table_stock_count");\n\n' +
   '      for (let index = 0; index < tableStockCount.length; index++) {\n        if (tableStockCount[index].line_status === "Approved") {',
   '};\n\nconst showReview = async (scStatus, reviewStatus) => {', "sc2k_count_block.js"],
  ['  setTimeout(async () => {\n    if (scStatus === "In Progress") {\n      const tableStockCount = await this.getValue("table_stock_count");\n\n' +
   '      for (let index = 0; index < tableStockCount.length; index++) {\n        if (tableStockCount[index].line_status === "Pending") {',
   '};\n\n(async () => {\n  let pageStatus = "";\n', "sc2k_review_block.js"],
];
const srcOf = (f) => fs.readFileSync(path.join(SAV2, "client/src", f), "utf8");
const withSc2k = (doc) => {
  const d = clone(doc);
  const m = byName(d, "mounted");
  for (const [start, end, file] of SC2K) {
    const i = m.func.indexOf(start);
    const j = m.func.indexOf(end);
    if (i < 0 || j < i || m.func.indexOf(start, i + 1) >= 0 || m.func.indexOf(end, j + 1) >= 0) throw new Error("withSc2k: anchors of " + file);
    m.func = m.func.slice(0, i) + srcOf(file) + m.func.slice(j);
  }
  byName(d, "onClick_syncAll").func = srcOf("scV2_onClick_syncAll.js");
  return d;
};
const REAL = { SUBMIT: IDS.SA_V2_SUBMIT, WORKER: IDS.SA_V2_WORKER };

module.exports = { withSc2k, ROOT, SAV2, FILES, IDS, REAL, OFF_IDS, readJSON, clone, findModel, byName, byKey, sourceOf, world, compile, makeThis, drain, click, check, done, same, replaceOnce, variant, shippedState };
