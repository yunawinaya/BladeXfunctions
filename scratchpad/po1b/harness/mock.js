// Mock low-code form context + client db for the PO form handlers (Phase 1b harness), after the GR / Putaway mocks.
// Runtime semantics mirrored from the dev bundle (read 2026-10-15):
//  - handlers compile as `function () { <func> }` (type js) or `async function () { <rules as code> }` (type rule),
//    called with this = the form and arguments[0] = the event args; triggerEvent returns the handler's own return value
//  - getValues() = deep clone; getValue(path) = live value. A path segment on an array resolves through
//    resolveArrayChildByPath: a DEEP fm_key scan of the whole tree first, then the numeric index, else every row
//    (wildcard) - so every row-path key costs a scan of the table (counted as `scan`)
//  - setData(obj) applies one tick later; per key: old value, write, new value (three resolutions). A whole-table write
//    gets fm_keys (tree mode: row id, else a new key; children get parent_fm_key)
//  - cascade "fire": a changed row-path / column-path cell runs that column's onChange for its row, after the write
//    (the coordinator's verified platform fact; "none" = no cascade). Header fields fire their onChange when changed.
//  - disabled(paths): row states keyed by the row's fm_key; each path copies the state map (`stateCopies`)
//  - runWorkflow(id, params, ok, fail) = request.then(r => (ok(r), r)).catch(e => fail(e)): ok is NOT awaited
//  - $confirm with beforeClose resolves on confirm / rejects on cancel or close once done() is called
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
  const matchWhere = (row, where) => Object.entries(where || {}).every(([k, v]) => String(row[k]) === String(v));
  const leaves = (spec) => {
    const out = [];
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n) return;
      if (n.type === "branch") {
        if (n.operator !== "all") throw new Error("mock db: only 'all' branches");
        return walk(n.children);
      }
      out.push(n);
    };
    walk(spec);
    return out;
  };
  const test = (row, leaf) => {
    const v = row[leaf.prop];
    if (leaf.operator === "in") return (Array.isArray(leaf.value) ? leaf.value : [leaf.value]).map(String).includes(String(v));
    if (leaf.operator === "equal" || leaf.operator === "numberEqual") return String(v) === String(leaf.value);
    throw new Error("mock db: unsupported operator " + leaf.operator);
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
        await new Promise((r) => realSetTimeout(r, latency));
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
          const ls = leaves(q.filter);
          ls.filter((l) => l.operator === "in").forEach((l) => counts.add(name + ":inIds", (Array.isArray(l.value) ? l.value : [l.value]).length));
          ls.filter((l) => l.operator === "in").forEach((l) => counts.c[name + ":maxInIds"] = Math.max(counts.get(name + ":maxInIds"), (Array.isArray(l.value) ? l.value : [l.value]).length));
          rows = rows.filter((r) => ls.every((l) => test(r, l)));
        }
        const key = name + ":" + kind + (name === "Item" ? (q.fields ? ":projected" : ":UNPROJECTED") : "");
        counts.add(key);
        counts.add("total");
        log.push({ key, n: rows.length, fields: q.fields });
        return { data: rows.map((r) => project(r, q.fields)) };
      },
    };
    return api;
  }
  return { db: { collection }, counts, stats: () => ({ maxInflight }), log };
}

// ---------------------------------------------------------------- handler compilation (as loadEvents / ft$5)
function ruleCode(rules) {
  return (rules || [])
    .map((r) => {
      const o = r.options || {};
      const cond = o.isCondition ? ` if (${o.condition || "false"}) ` : "";
      if (r.action === "js") return o.func;
      if (r.action === "triggerEvent") return o.functionName ? `${cond} this.triggerEvent('${o.functionName}');` : "";
      if (r.action === "refreshFieldOptionData") return o.field ? `${cond} this.refreshFieldOptionData('${o.field}', {});` : "";
      throw new Error("mock: rule action not modelled: " + r.action);
    })
    .join("\n");
}

function compileForm(form, Filter_) {
  const out = {};
  for (const e of form.config.eventScript) {
    const body = e.type === "rule" ? ruleCode(e.rules) : e.func || "";
    if (/\{\{(system|global|value|params|widget):/.test(body)) throw new Error("mock: placeholder in " + e.name);
    const async = e.type === "rule" || e.async === true;
    const fn = new Function("db", "Filter", `return ${async ? "async " : ""}function () {\n${body}\n}`);
    out[e.name] = { key: e.key, make: (db) => fn(db, Filter_) };
  }
  return out;
}

// column model -> { onChange, ... } handler NAMES, and header field -> onChange NAME
function eventMaps(form) {
  const keyToName = Object.fromEntries(form.config.eventScript.map((e) => [e.key, e.name]));
  const columns = {};
  const header = {};
  let tableColumns = null;
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if (node.type === "table" && node.model === "table_po") {
      tableColumns = node.tableColumns;
      node.tableColumns.forEach((c) => {
        columns[c.model] = Object.fromEntries(Object.entries(c.events || {}).filter(([, v]) => v).map(([k, v]) => [k, keyToName[v] || v]));
      });
      return;
    }
    if (node.model && node.events && node.events.onChange) header[node.model] = keyToName[node.events.onChange];
    ["list", "columns", "tabs"].forEach((k) => node[k] && walk(node[k]));
  };
  walk(form.list);
  return { columns, header, tableColumns };
}

// ---------------------------------------------------------------- form
function makeForm(initialModels, opts = {}) {
  const models = clone(initialModels);
  const counts = new Counter();
  const compiled = opts.compiled || {};
  const columnEvents = opts.columnEvents || {};
  const headerEvents = opts.headerEvents || {};
  const cascade = opts.cascade || "none";
  let keySeq = 0;
  const disabledState = {};
  const optionState = {};
  const shown = {};
  const messages = [];
  const dialogs = [];
  const runs = [];
  const childHidden = [];
  let stateSize = 0;
  const form = {};
  const handlers = {};
  const db = opts.db;

  const genKey = () => "k" + String(++keySeq).padStart(7, "0");
  const ensureFmKeyDeep = (rows, parentKey) => {
    (rows || []).forEach((r) => {
      if (!r || typeof r !== "object") return;
      if (!r.fm_key) r.fm_key = r.id != null && r.id !== "" ? r.id : genKey();
      if (parentKey !== undefined) r.parent_fm_key = parentKey;
      if (Array.isArray(r.children)) ensureFmKeyDeep(r.children, r.fm_key);
    });
  };
  ensureFmKeyDeep(models.table_po);

  const findByRowKeyDeep = (arr, key) => {
    if (!Array.isArray(arr)) return null;
    for (const r of arr) {
      counts.add("scan");
      if (r && r.fm_key === key) return r;
      const hit = findByRowKeyDeep(r && r.children, key);
      if (hit) return hit;
    }
    return null;
  };
  const resolveChild = (arr, seg) => {
    const byKey = findByRowKeyDeep(arr, seg);
    if (byKey) return { match: "rowKey", row: byKey };
    const n = Number(seg);
    return !Number.isNaN(n) && seg !== "" ? { match: "index", row: arr[n] } : { match: "wildcard" };
  };
  const resolve = (segs) => {
    let cur = models;
    for (let i = 0; i < segs.length; i++) {
      if (cur == null) return undefined;
      if (Array.isArray(cur)) {
        const g = resolveChild(cur, segs[i]);
        if (g.match === "wildcard") return undefined;
        cur = g.row;
      } else cur = cur[segs[i]];
    }
    return cur;
  };
  const getValue = (path) => {
    counts.add("getValue");
    const segs = path.split(".");
    const walk = (cur, rest) => {
      if (rest.length === 0) return cur;
      if (Array.isArray(cur)) {
        const g = resolveChild(cur, rest[0]);
        return g.match === "wildcard" ? cur.map((r) => walk(r && r[rest[0]], rest.slice(1))) : walk(g.row, rest.slice(1));
      }
      if (cur == null) return undefined;
      return rest.length === 1 ? cur[rest[0]] : walk(cur[rest[0]], rest.slice(1));
    };
    return walk(models, segs);
  };
  // setData_ write: rows of a wildcard segment are all written; returns the rows a table write touched
  const write = (obj, segs, value, touched) => {
    const h = segs.shift();
    if (segs.length === 0) {
      obj[h] = value;
      return;
    }
    if (!(h in obj)) return;
    const f = obj[h];
    if (!Array.isArray(f)) return write(f, segs, value, touched);
    const g = resolveChild(f, segs[0]);
    if (g.match === "rowKey" || g.match === "index") {
      segs.shift();
      if (g.row !== undefined) {
        if (touched && segs.length === 1) touched.push({ row: g.row, field: segs[0], old: g.row[segs[0]] });
        write(g.row, segs, value, touched);
      }
    } else {
      f.forEach((m) => {
        if (touched && segs.length === 1) touched.push({ row: m, field: segs[0], old: m[segs[0]] });
        write(m, [...segs], value, touched);
      });
    }
  };
  // a nested child reports its top-level parent's index
  const topIndexOf = (row) => {
    const rows = models.table_po || [];
    const holds = (r) => r === row || (Array.isArray(r && r.children) && r.children.some(holds));
    return rows.findIndex(holds);
  };
  const runHandler = (name, args) => {
    const h = handlers[name];
    if (!h) return undefined;
    counts.add("run:" + name);
    if (name !== "POcalculation") return h.call(form, args);
    // a call that only queues the tick's recalculation (or finds it queued) computes nothing
    const queued = !!form.__poCalcQueued;
    const ret = h.call(form, args);
    if ((args && (args.calcRows || args.poCalcNow)) || (!queued && !form.__poCalcQueued)) counts.add("calc:POcalculation");
    return ret;
  };
  const fire = (name, args) => {
    counts.add("onChange:" + name);
    try {
      const r = runHandler(name, args);
      if (r && typeof r.then === "function") r.catch((e) => counts.add("handlerRejected:" + name));
    } catch (e) {
      counts.add("handlerThrew:" + name);
      form.__errors.push(name + ": " + e.message);
    }
  };

  Object.assign(form, {
    models,
    isAdd: opts.mode === "Add",
    isEdit: opts.mode === "Edit",
    isView: opts.mode === "View",
    isCopy: opts.mode === "Clone",
    __errors: [],
    getValue,
    getValues() {
      counts.add("getValues");
      counts.add("getValues.rows", (models.table_po || []).length);
      return clone(models);
    },
    setData(obj, ...rest) {
      counts.add("setData");
      const keys = Object.keys(obj || {});
      counts.add("setData.keys", keys.length);
      keys.forEach((k) => {
        if (k.startsWith("table_po.")) counts.add("setData.rowPathKeys");
        if (k === "table_po") counts.add("setData.wholeTable");
      });
      const value = obj;
      return Promise.resolve().then(() => {
        const changedCells = [];
        const changedHeader = [];
        keys.forEach((k) => {
          const segs = k.split(".");
          const before = resolve(segs);
          const touched = k.startsWith("table_po.") ? [] : null;
          write(models, [...segs], value[k], touched);
          const after = resolve(segs);
          if (touched) {
            touched.forEach((t) => {
              if (!Object.is(t.old, t.row[t.field])) changedCells.push({ row: t.row, field: t.field, value: t.row[t.field] });
            });
          } else if (segs.length === 1 && JSON.stringify(before) !== JSON.stringify(after)) changedHeader.push(k);
        });
        if (keys.includes("table_po")) ensureFmKeyDeep(models.table_po);
        if (changedCells.length || keys.includes("table_po")) counts.add("tableWatcherRuns");
        // onChange runs after the write, in the watcher flush
        return Promise.resolve().then(() => {
          changedHeader.forEach((k) => {
            const name = headerEvents[k];
            if (name) fire(name, { value: models[k], field: k });
          });
          if (cascade !== "fire") return;
          changedCells.forEach(({ row, field, value }) => {
            const name = (columnEvents[field] || {}).onChange;
            if (name) fire(name, { value, row, rowIndex: topIndexOf(row), field, fieldModel: undefined });
          });
        });
      });
    },
    disabled(paths, flag) {
      const list = typeof paths === "string" ? [paths] : paths;
      counts.add("disabled");
      counts.add("disabled.paths", list.length);
      list.forEach((p) => {
        const segs = p.split(".");
        let k = p;
        if (segs[0] === "table_po" && segs.length >= 3) {
          const g = resolveChild(models.table_po || [], segs[1]);
          k = g.row ? "table_po.#" + g.row.fm_key + "." + segs.slice(2).join(".") : "table_po.<missing:" + segs[1] + ">";
        }
        counts.add("stateCopies", stateSize);
        if (!(k in disabledState)) stateSize++;
        disabledState[k] = !!flag;
      });
    },
    display(paths) {
      counts.add("display");
      (typeof paths === "string" ? [paths] : paths).forEach((p) => (shown[p] = true));
    },
    hide(paths) {
      counts.add("hide");
      (typeof paths === "string" ? [paths] : paths).forEach((p) => (shown[p] = false));
    },
    refreshFieldOptionData(paths) {
      const list = typeof paths === "string" ? [paths] : paths;
      counts.add("refreshFieldOptionData");
      counts.add("refreshFieldOptionData.paths", list.length);
      list.forEach((p) => {
        if (/^table_po\.[^.]+$/.test(p)) counts.add("refreshFieldOptionData.columnPaths");
      });
      return Promise.resolve([]);
    },
    setOptionData(paths, data) {
      counts.add("setOptionData");
      (typeof paths === "string" ? [paths] : paths).forEach((p) => (optionState[p] = JSON.stringify(data)));
      return Promise.resolve();
    },
    getOptionData: () => [],
    onDropdownVisible: async () => [],
    getComponent(name) {
      if (opts.components && opts.components[name]) return opts.components[name];
      if (name === "table_po") return { hideChildRecord: (keys, flag, o) => childHidden.push([clone(keys), flag, clone(o)]) };
      return { options: {} };
    },
    getVarGlobal: (k) => (opts.globals || {})[k],
    getVarSystem: (k) => (opts.system || {})[k] || "",
    getParamsVariables: (k) => (opts.params || {})[k],
    triggerEvent(name, args) {
      counts.add("triggerEvent");
      counts.add("trigger:" + name);
      return runHandler(name, args);
    },
    openDialog: async (n) => dialogs.push("open " + n),
    closeDialog: async (n) => dialogs.push("close " + n),
    toView: (o) => dialogs.push("toView " + JSON.stringify(o)),
    $nextTick: (fn) => Promise.resolve().then(fn),
    runWorkflow(id, params, ok, fail) {
      counts.add("runWorkflow");
      counts.add("runWorkflow.items", ((params || {}).item_data || []).length);
      runs.push({ id, n: ((params || {}).item_data || []).length });
      const request = new Promise((res, rej) =>
        realSetTimeout(() => {
          const answer = opts.workflow ? opts.workflow(id, clone(params)) : { code: 200, data: {} };
          if (answer && answer.__reject) rej(answer.__reject);
          else res(answer);
        }, opts.wfLatency || 0),
      );
      return request.then((r) => (ok && ok(r), r)).catch((e) => {
        if (fail) return fail(e);
        throw e;
      });
    },
    $confirm(message, title, o = {}) {
      const action = opts.confirm ? opts.confirm(message, title) : "confirm";
      messages.push("confirm[" + action + "]: " + title + ": " + String(message).replace(/\s+/g, " "));
      if (typeof o.beforeClose === "function") {
        return new Promise((res, rej) => {
          o.beforeClose(action, {}, () => (action === "confirm" ? res("confirm") : rej(action)));
        });
      }
      return action === "confirm" ? Promise.resolve("confirm") : Promise.reject(action);
    },
    $alert(message, title) {
      messages.push("alert: " + title + ": " + message);
      return Promise.resolve();
    },
    $message: {
      success: (m) => messages.push("ok: " + m),
      warning: (m) => messages.push("warn: " + m),
      error: (m) => messages.push("error: " + m),
    },
    showLoading() {},
    hideLoading() {},
  });
  for (const [name, c] of Object.entries(compiled)) handlers[name] = c.make(db);

  form.__snapshot = () => ({
    models: clone(models),
    disabledState: { ...disabledState },
    optionState: { ...optionState },
    shown: { ...shown },
    messages: messages.slice(),
    dialogs: dialogs.slice(),
    runs: clone(runs),
    childHidden: clone(childHidden),
    counts: { ...counts.c },
    errors: form.__errors.slice(),
  });
  form.__run = (name, args) => runHandler(name, args);
  return form;
}

const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;
const settle = (ms) => new Promise((r) => realSetTimeout(r, ms));
// timers the handlers start, so a run is idle only when none is pending
const timers = { pending: new Set() };
globalThis.setTimeout = (fn, ms, ...args) => {
  const id = realSetTimeout(() => {
    timers.pending.delete(id);
    fn(...args);
  }, ms);
  timers.pending.add(id);
  return id;
};
globalThis.clearTimeout = (id) => {
  timers.pending.delete(id);
  realClearTimeout(id);
};

function install(dbApi) {
  globalThis.db = dbApi.db;
  globalThis.Filter = Filter;
  globalThis.window = globalThis.window || globalThis;
  globalThis.document = { getElementById: () => null, querySelector: () => null };
}

module.exports = { makeDb, makeForm, compileForm, eventMaps, settle, install, clone, Filter, ruleCode, timers };
