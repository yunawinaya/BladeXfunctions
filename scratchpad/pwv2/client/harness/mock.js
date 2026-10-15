// Mock low-code form context + client db for the Putaway form handlers (Phase 4 harness), after the GR Phase 2 mock.
// Platform semantics mirrored from the dev runtime bundle (read 2026-10-14 / 15):
//  - getValues() = deep clone of the whole model; getValue(path) = live value, array segments by fm_key (deep, through
//    `children`), else index
//  - setData(obj) writes each path one tick later; a row-path key (table_putaway_item.<row>.<col>) runs that column's
//    onChange for the row (whole-table writes run none - unverified on the platform, same for old and new)
//  - row-level disabled / option state is keyed by the row's fm_key (VTable setRuntimeDisabled); every path of a
//    disabled() call copies the whole state map (applyRuntimeDisabledState) - counted as `stateCopies`
//  - effective cell state = the row's runtime state, else a column-level state, else the column's options.disabled
//    (boolean, or an expression evaluated with arguments[0] = { row, index })
"use strict";

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

class Counter {
  constructor() {
    this.c = {};
  }
  add(k, n = 1) {
    this.c[k] = (this.c[k] || 0) + n;
  }
  get(k) {
    return this.c[k] || 0;
  }
}

// ---------------------------------------------------------------- Filter / db
class Filter {
  constructor(operator = "all") {
    this._operator = operator;
    this._children = [];
  }
  where(prop, operator, value) {
    this._children.push({ prop, operator, value });
    return this;
  }
  in(prop, value) {
    return this.where(prop, "in", value);
  }
  build() {
    return this._children.length === 1 ? clone(this._children[0]) : { type: "branch", operator: this._operator, children: clone(this._children) };
  }
}

function makeDb(tables, opts = {}) {
  const latency = opts.latency || 0;
  const counts = new Counter();
  let inflight = 0;
  let maxInflight = 0;
  const log = [];
  // String compare, as a where() on the platform: an undefined value matches nothing
  const matchWhere = (row, where) => Object.entries(where || {}).every(([k, v]) => String(row[k]) === String(v));
  const condsOf = (spec) => {
    const out = [];
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n) return;
      if (n.type === "branch") walk(n.children);
      else if (n.operator === "in") out.push({ prop: n.prop, values: n.value });
      else throw new Error("mock db: unsupported filter " + JSON.stringify(n));
    };
    walk(spec);
    return out;
  };
  const project = (row, fields) => {
    if (!fields) return clone(row);
    const out = { id: row.id };
    fields.split(",").forEach((f) => {
      if (f in row) out[f] = clone(row[f]);
    });
    return out;
  };
  function collection(name) {
    const q = { fields: null, where: null, filter: null, doc: null };
    const api = {
      field(f) {
        q.fields = f;
        return api;
      },
      where(w) {
        q.where = w;
        return api;
      },
      filter(f) {
        q.filter = f;
        return api;
      },
      doc(id) {
        q.doc = id;
        return api;
      },
      async update(obj) {
        counts.add(name + ":update");
        log.push({ key: name + ":update", obj: clone(obj) });
        return { data: [] };
      },
      async add(obj) {
        counts.add(name + ":add");
        log.push({ key: name + ":add", obj: clone(obj) });
        return { data: [] };
      },
      async get() {
        inflight++;
        maxInflight = Math.max(maxInflight, inflight);
        await new Promise((r) => setTimeout(r, latency));
        inflight--;
        const all = tables[name];
        if (!all) throw new Error("mock db: no table " + name);
        let rows = Array.isArray(all) ? all : Object.values(all);
        let kind = "query";
        if (q.doc !== null) {
          kind = "doc";
          rows = rows.filter((r) => String(r.id) === String(q.doc));
        }
        if (q.where) rows = rows.filter((r) => matchWhere(r, q.where));
        if (q.filter) {
          kind = "in";
          condsOf(q.filter).forEach(({ prop, values }) => {
            const set = new Set(values.map(String));
            rows = rows.filter((r) => set.has(String(r[prop])));
          });
        }
        const key = name + ":" + kind + (name === "Item" ? (q.fields ? ":projected" : ":UNPROJECTED") : "");
        counts.add(key);
        counts.add("total");
        log.push({ key, n: rows.length });
        return { data: rows.map((r) => project(r, q.fields)) };
      },
    };
    return api;
  }
  return { db: { collection }, counts, stats: () => ({ maxInflight }), log };
}

// ---------------------------------------------------------------- form
const TABLES = ["table_putaway_item", "table_putaway_records"];

function makeForm(initialModels, opts = {}) {
  const models = clone(initialModels);
  const counts = new Counter();
  const handlers = opts.handlers || {}; // name -> code
  const onChange = opts.onChange || {}; // "table.column" -> handler name
  let keySeq = 0;
  const disabledState = {}; // "<table>.#<fm_key>.<col>" or "<path>" (column / field level)
  const optionState = {};
  const shown = {};
  const messages = [];
  const dialogs = [];
  const runs = [];
  let stateSize = 0;

  const ensureKeys = (rows, parentKey) => {
    (rows || []).forEach((r) => {
      if (r && typeof r === "object") {
        if (!r.fm_key) r.fm_key = "n" + String(++keySeq).padStart(5, "0");
        if (parentKey !== undefined && !r.parent_fm_key) r.parent_fm_key = parentKey;
        if (Array.isArray(r.children)) ensureKeys(r.children, r.fm_key);
      }
    });
  };
  TABLES.forEach((t) => ensureKeys(models[t]));

  const findByKeyDeep = (arr, key) => {
    for (const r of arr) {
      if (!r) continue;
      if (r.fm_key === key) return r;
      if (Array.isArray(r.children)) {
        const hit = findByKeyDeep(r.children, key);
        if (hit) return hit;
      }
    }
    return null;
  };
  const childOf = (arr, seg) => {
    const byKey = findByKeyDeep(arr, seg);
    if (byKey) return byKey;
    const n = Number(seg);
    return !Number.isNaN(n) && seg !== "" ? arr[n] : undefined;
  };
  const resolve = (path) => {
    let cur = models;
    for (const seg of path.split(".")) {
      if (cur == null) return undefined;
      cur = Array.isArray(cur) ? childOf(cur, seg) : cur[seg];
    }
    return cur;
  };
  const getValue = (path) => {
    counts.add("getValue");
    return resolve(path);
  };

  // a row path -> { table, row, rowIndex, field } (top-level row index; a `children.<j>` row reports its parent's index)
  const rowTarget = (path) => {
    const segs = path.split(".");
    const t = TABLES.find((x) => segs[0] === x);
    if (!t || segs.length < 3) return null;
    let rows = models[t] || [];
    let row = childOf(rows, segs[1]);
    if (!row) return { table: t, missing: segs.slice(1).join(".") };
    const rowIndex = rows.indexOf(row);
    let i = 2;
    while (segs[i] === "children" && Array.isArray(row.children) && segs[i + 1] !== undefined) {
      const c = childOf(row.children, segs[i + 1]);
      if (!c) break;
      row = c;
      i += 2;
    }
    return { table: t, row, rowIndex, field: segs.slice(i).join(".") };
  };
  const stateKey = (path) => {
    const t = rowTarget(path);
    if (!t) return path;
    if (t.missing) return t.table + ".<missing:" + t.missing + ">";
    return t.table + ".#" + t.row.fm_key + "." + t.field;
  };

  const writePath = (path, value) => {
    const segs = path.split(".");
    let cur = models;
    for (let i = 0; i < segs.length - 1; i++) {
      if (cur == null) return;
      cur = Array.isArray(cur) ? childOf(cur, segs[i]) : cur[segs[i]];
    }
    if (cur == null) return;
    const last = segs[segs.length - 1];
    if (Array.isArray(cur)) {
      const row = childOf(cur, last);
      if (row) Object.assign(row, value);
    } else cur[last] = clone(value);
  };

  const asList = (p) => (typeof p === "string" ? [p] : p);
  const fire = (path, value) => {
    const t = rowTarget(path);
    if (!t || t.missing || t.field.includes(".")) return;
    const name = onChange[t.table + "." + t.field];
    if (!name || !handlers[name]) return;
    counts.add("onChange:" + name);
    runCode(form, handlers[name], { value, rowIndex: t.rowIndex, row: t.row, field: t.field });
  };

  const form = {
    models,
    isAdd: opts.mode === "Add",
    isEdit: opts.mode === "Edit",
    isView: opts.mode === "View",
    isCopy: false,
    getValue,
    getValues() {
      counts.add("getValues");
      return clone(models);
    },
    setData(obj) {
      counts.add("setData");
      const keys = Object.keys(obj);
      counts.add("setData.keys", keys.length);
      keys.forEach((k) => {
        if (TABLES.some((t) => k.startsWith(t + "."))) counts.add("setData.rowPathKeys");
        if (TABLES.includes(k)) counts.add("setData.wholeTable");
      });
      return Promise.resolve().then(() => {
        keys.forEach((k) => writePath(k, obj[k]));
        TABLES.forEach((t) => {
          if (keys.includes(t)) ensureKeys(models[t]);
        });
        keys.forEach((k) => fire(k, obj[k]));
      });
    },
    disabled(paths, flag) {
      const list = asList(paths);
      counts.add("disabled");
      counts.add("disabled.paths", list.length);
      list.forEach((p) => {
        const k = stateKey(p);
        counts.add("stateCopies", stateSize);
        if (!(k in disabledState)) stateSize++;
        disabledState[k] = !!flag;
      });
    },
    display(paths) {
      counts.add("display");
      asList(paths).forEach((p) => (shown[p] = true));
    },
    hide(paths) {
      counts.add("hide");
      asList(paths).forEach((p) => (shown[p] = false));
    },
    setOptionData(paths, data) {
      const list = asList(paths);
      counts.add("setOptionData");
      counts.add("setOptionData.paths", list.length);
      const j = JSON.stringify(data);
      list.forEach((p) => (optionState[stateKey(p)] = j));
      return Promise.resolve();
    },
    getOptionData: () => [],
    onDropdownVisible: async () => [],
    getComponent: () => ({ hideChildRecord() {}, options: {} }),
    getVarGlobal: (k) => (opts.globals || {})[k],
    getVarSystem: (k) => (opts.system || {})[k] || "",
    triggerEvent(name, args) {
      counts.add("triggerEvent");
      counts.add("trigger:" + name);
      const code = handlers[name];
      if (!code) return undefined;
      return runCode(form, code, args);
    },
    openDialog: async (n) => dialogs.push("open " + n),
    closeDialog: async (n) => dialogs.push("close " + n),
    runWorkflow(id, params, ok, fail) {
      counts.add("runWorkflow");
      runs.push({ id, params: clone(params) });
      const answer = opts.workflow ? opts.workflow(id, clone(params)) : { data: { code: "200", message: "ok" } };
      return Promise.resolve().then(() => (answer && answer.error ? fail && fail(answer.error) : ok && ok(answer)));
    },
    parentGenerateForm: { $refs: { SuPageDialogRef: { hide: () => dialogs.push("page closed") } }, refresh: () => dialogs.push("list refreshed") },
    $message: {
      success: (m) => messages.push("ok: " + m),
      warning: (m) => messages.push("warn: " + m),
      error: (m) => messages.push("error: " + m),
    },
    $confirm: () => Promise.resolve(),
    showLoading() {},
    hideLoading() {},
  };

  form.__snapshot = () => ({
    models: clone(models),
    disabledState: { ...disabledState },
    optionState: { ...optionState },
    shown: { ...shown },
    messages: messages.slice(),
    dialogs: dialogs.slice(),
    runs: clone(runs),
    counts: { ...counts.c },
  });
  return form;
}

function runCode(form, code, args) {
  return new Function(code).call(form, args);
}

function runValidator(form, code, rule, value) {
  return new Promise((resolve) => {
    new Function("rule", "value", "callback", code).call(form, rule, value, (err) => resolve(err === undefined ? "OK" : String(err)));
  });
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

function install(dbApi) {
  globalThis.db = dbApi.db;
  globalThis.Filter = Filter;
  globalThis.window = globalThis.window || globalThis;
  globalThis.localStorage = globalThis.localStorage || (() => {
    const m = {};
    return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => (m[k] = String(v)) };
  })();
}

module.exports = { makeDb, makeForm, runCode, runValidator, settle, install, clone, Filter };
