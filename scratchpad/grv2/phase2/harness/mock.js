// Mock low-code form context + client db for the GR form handlers (Phase 2 harness).
// Platform semantics mirrored from the dev runtime bundle (read 2026-10-14):
//  - getValues() = deep clone of the whole model; getValue(path) = live value, array segments by fm_key, else index
//  - setData(obj) writes each path one tick later; disabled/display/hide/setOptionData take one path or an array
//  - row-level disabled / option state is keyed by the row's fm_key (VTable runtime), so it follows the row
//  - triggerEvent(name, args) runs the handler and returns its (undefined) result without awaiting inner work
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
// as the runtime's Filter: build() returns the single leaf, else an "all" branch
class Filter {
  constructor(operator = "all") {
    this._operator = operator;
    this._children = [];
  }
  in(prop, value) {
    this._children.push({ prop, operator: "in", value });
    return this;
  }
  build() {
    return this._children.length === 1 && this._children[0].type !== "branch"
      ? this._children[0]
      : { type: "branch", operator: this._operator, children: JSON.parse(JSON.stringify(this._children)) };
  }
}

function makeDb(tables, opts = {}) {
  const latency = opts.latency || 0;
  const counts = new Counter();
  let inflight = 0;
  let maxInflight = 0;
  const log = [];

  const matchWhere = (row, where) =>
    Object.entries(where || {}).every(([k, v]) => String(row[k]) === String(v));

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
    const q = { name, fields: null, where: null, filter: null, doc: null };
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
      // writes: recorded, applied as partial updates (only the keys sent), as the client API does
      async add(obj) {
        counts.add(name + ":add");
        log.push({ key: name + ":add", obj: clone(obj) });
        const rows = tables[name] || (tables[name] = []);
        rows.push({ id: "new-" + rows.length, ...clone(obj) });
        return { data: [rows[rows.length - 1]] };
      },
      async update(obj) {
        counts.add(name + ":update");
        log.push({ key: name + ":update", obj: clone(obj) });
        const rows = Array.isArray(tables[name]) ? tables[name] : Object.values(tables[name] || {});
        rows
          .filter((r) => (q.doc !== null ? String(r.id) === String(q.doc) : true))
          .filter((r) => (q.where ? matchWhere(r, q.where) : true))
          .forEach((r) => Object.assign(r, clone(obj)));
        return { data: [] };
      },
      async get() {
        inflight++;
        maxInflight = Math.max(maxInflight, inflight);
        await new Promise((r) => setTimeout(r, latency));
        inflight--;
        const rowsAll = tables[name];
        if (!rowsAll) throw new Error("mock db: no table " + name);
        let rows = Array.isArray(rowsAll) ? rowsAll : Object.values(rowsAll);
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
  return {
    db: { collection },
    counts,
    stats: () => ({ maxInflight }),
    log,
  };
}

// ---------------------------------------------------------------- form
function makeForm(initialModels, opts = {}) {
  const models = clone(initialModels);
  const counts = new Counter();
  const handlers = opts.handlers || {};
  let keySeq = opts.keySeq || 0;
  const disabledState = {};
  const optionState = {};
  const shown = {};
  const messages = [];
  const setDataLog = [];

  const ensureKeys = (rows) => {
    (rows || []).forEach((r) => {
      if (r && typeof r === "object") {
        if (!r.fm_key) r.fm_key = "k" + String(++keySeq).padStart(5, "0");
        if (Array.isArray(r.children)) ensureKeys(r.children);
      }
    });
  };
  ensureKeys(models.table_gr);

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

  const getValue = (path) => {
    counts.add("getValue");
    let cur = models;
    for (const seg of path.split(".")) {
      if (cur == null) return undefined;
      cur = Array.isArray(cur) ? childOf(cur, seg) : cur[seg];
    }
    return cur;
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

  // runtime state key: a row path resolves to that row's fm_key (as the VTable runtime does)
  const stateKey = (path) => {
    const segs = path.split(".");
    if (segs[0] !== "table_gr" || segs.length < 3) return path;
    let rows = models.table_gr || [];
    let row = null;
    let i = 1;
    for (; i < segs.length; i++) {
      const r = childOf(rows, segs[i]);
      if (!r) break;
      row = r;
      if (segs[i + 1] === "children" && Array.isArray(r.children)) {
        rows = r.children;
        i++;
        continue;
      }
      i++;
      break;
    }
    if (!row) return "table_gr.<missing:" + segs.slice(1).join(".") + ">";
    return "table_gr.#" + row.fm_key + "." + segs.slice(i).join(".");
  };

  const asList = (p) => (typeof p === "string" ? [p] : p);

  const form = {
    models,
    isAdd: opts.mode === "Add",
    isEdit: opts.mode === "Edit",
    isView: opts.mode === "View",
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
        if (/^table_gr\.[^.]+\./.test(k)) counts.add("setData.rowPathKeys");
        if (k === "table_gr") counts.add("setData.wholeTable");
      });
      setDataLog.push(keys.length > 6 ? keys.slice(0, 6).concat(["…" + keys.length]) : keys);
      return Promise.resolve().then(() => {
        keys.forEach((k) => writePath(k, obj[k]));
        if (keys.some((k) => k === "table_gr")) ensureKeys(models.table_gr);
      });
    },
    disabled(paths, flag) {
      const list = asList(paths);
      counts.add("disabled");
      counts.add("disabled.paths", list.length);
      list.forEach((p) => {
        disabledState[stateKey(p)] = !!flag;
      });
    },
    display(paths) {
      const list = asList(paths);
      counts.add("display");
      list.forEach((p) => {
        shown[p] = true;
      });
    },
    hide(paths) {
      const list = asList(paths);
      counts.add("hide");
      list.forEach((p) => {
        shown[p] = false;
      });
    },
    setOptionData(paths, data) {
      const list = asList(paths);
      counts.add("setOptionData");
      counts.add("setOptionData.paths", list.length);
      const j = JSON.stringify(data);
      list.forEach((p) => {
        optionState[stateKey(p)] = j;
      });
      return Promise.resolve();
    },
    getOptionData: () => [],
    onDropdownVisible: async () => ({}),
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
    $message: {
      success: (m) => messages.push("ok: " + m),
      warning: (m) => messages.push("warn: " + m),
      error: (m) => messages.push("error: " + m),
    },
    $confirm: () => Promise.resolve(),
    $alert: () => Promise.resolve(),
    showLoading() {},
    hideLoading() {},
  };

  form.__snapshot = () => ({
    models: clone(models),
    disabledState: { ...disabledState },
    optionState: { ...optionState },
    shown: { ...shown },
    messages: messages.slice(),
    counts: { ...counts.c },
    setDataLog: setDataLog.slice(),
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
  globalThis.document = { querySelector: () => null };
  globalThis.window = globalThis.window || globalThis;
}

module.exports = { makeDb, makeForm, runCode, runValidator, settle, install, clone, Filter };
