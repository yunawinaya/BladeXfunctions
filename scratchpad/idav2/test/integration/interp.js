// The FlowGram interpreter of lib/sim/engine.js (wrapped, never edited) with the platform features the five built workflows and the
// deployed engine use: ConditionRule if-nodes, tryCatch (a caught error lets the run go on but still FAILS it for a calling
// workflow-node - memory project_lowcode_trycatch_semantics), atomic-count-node (INVENTORY_LOCK_TOKENS), get / search nodes over the
// world's tables (the classic v7), callees resolved by the workflow id in the node (ids.json; the name next to it must agree), a token
// without a value injected as null (A's / B's platform rule), a distinct uuid per run, and per-run node data (every node's output +
// its injected script / SQL text / workflow params / write rows).
const crypto = require("crypto");
const path = require("path");
const { Engine, Mapped } = require(path.join(__dirname, "..", "..", "lib", "sim", "engine.js"));

const isStop = (e) => !!(e && e.constructor && e.constructor.name === "Stop");

class Interp extends Engine {
  // docs: name -> workflow JSON; ids: name -> id (ids.json); world: ./world.js
  constructor(world, docs, ids) {
    super({ dir: "/nonexistent", db: null, mocks: { sql: {}, read: {} } });
    this.w = world;
    this.docs = docs;
    this.ids = ids;
    this.byId = {};
    for (const [k, v] of Object.entries(ids)) if (typeof v === "string" && /^[0-9]+$/.test(v)) this.byId[v] = k;
    this.runs = [];
    this.calls = [];
    this.depth = 0;
  }

  load(name) {
    if (!this.docs[name]) throw new Error("no workflow " + name + " in the integration set");
    return this.docs[name];
  }

  run(name, params) {
    const wf = this.load(name);
    const n = ++this.w.runSeq;
    const h = crypto.createHash("md5").update("ida-integration-run-" + n).digest("hex");
    const uuid = h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20, 32);
    const ctx = { name: name, params: params || {}, out: {}, loops: {}, uuid: uuid, bytes: 0, inBytes: 0, caught: [], run: n };
    const rec = { name: name, run: n, depth: this.depth, out: 0, in: 0, ms: 0, nodes: 0, maxCodeMs: 0, caught: [], failed: null, returned: null };
    this.runs.push(rec);
    this.depth++;
    const t0 = Date.now();
    try {
      this.block(wf.nodes, ctx);
      return { returned: null, ctx: ctx };
    } catch (e) {
      if (isStop(e)) {
        rec.returned = e.value;
        return { returned: e.value, ctx: ctx };
      }
      rec.failed = e.message;
      throw e;
    } finally {
      this.depth--;
      rec.out = ctx.bytes;
      rec.in = ctx.inBytes;
      rec.ms = Date.now() - t0;
      rec.caught = ctx.caught;
      rec.nodes = ctx.nodes || 0;
      rec.maxCodeMs = ctx.maxCodeMs || 0;
    }
  }

  resolve(ref, ctx) {
    const m = ref.match(/^(node|workflowparams|system|global):(.+)$/);
    if (m && m[1] === "system") {
      if (m[2] === "tenantId") return this.w.T;
      if (m[2] === "uuid") return ctx.uuid;
      if (m[2] === "uid") return this.w.uid;
      return undefined;
    }
    return super.resolve(ref, ctx);
  }

  injectJs(text, ctx) {
    return text.replace(/\{\{([^}]+)\}\}/g, (_, ref) => {
      const v = this.resolve(ref, ctx);
      return v === undefined || v === null ? "null" : JSON.stringify(v);
    });
  }

  // ConditionRule leaves (A's Sim rule + the operators the v7 / engine rules use)
  rule(f, ctx, id) {
    if (f.type === "branch") {
      const kids = f.children || [];
      return f.operator === "all" ? kids.every((c) => this.rule(c, ctx, id)) : kids.some((c) => this.rule(c, ctx, id));
    }
    const v = this.resolve(String(f.prop).replace(/^(workflowparams|node)\./, "$1:"), ctx);
    const isNull = v === undefined || v === null;
    switch (f.operator) {
      case "equal":
        return String(v) === String(f.value);
      case "notEqual":
        return String(v) !== String(f.value);
      case "isNull":
        return isNull;
      case "isNotNull":
        return !isNull;
      case "numberEqual":
        return Number(v) === Number(f.value);
      case "greaterThan":
        return Number(v) > Number(f.value);
      default:
        throw new Error("operator " + f.operator + " not simulated (" + id + ")");
    }
  }

  measureIn(n, ctx) {
    const d = n.data || {};
    try {
      if (n.type === "code-node") return this.injectJs(d.script.code, ctx).length;
      if (n.type === "sql-node") return this.injectRaw(d.script.code, ctx).length;
      if (n.type === "workflow-node") {
        const p = {};
        for (const b of d.body_params.list) p[b.prop] = this.value(b.value, ctx);
        return JSON.stringify(p).length;
      }
    } catch (e) {
      /* a reference not resolvable yet: the node itself reports it */
    }
    return 0;
  }

  node(n, ctx) {
    const d = n.data || {};
    ctx.nodes = (ctx.nodes || 0) + 1;
    if (this.w.faults[n.id] > 0) {
      this.w.faults[n.id]--;
      throw new Error("injected fault at " + n.id);
    }
    ctx.inBytes += this.measureIn(n, ctx);
    switch (n.type) {
      case "if":
        if (d.condition_type === "ConditionRule") return this.block(n.blocks[this.rule(d.filter.list[0], ctx, n.id) ? 0 : 1].blocks, ctx);
        return super.node(n, ctx);
      case "condition-or-node":
        for (const item of n.blocks) {
          const list = ((item.data || {}).filter || {}).list || [];
          if (!(item.data || {}).isDefault && list.length !== 1) throw new Error(n.id + ": a condition-or item with " + list.length + " leaves is not simulated");
          if (list.length === 1 && list[0].type === "branch") throw new Error(n.id + ": a condition-or branch leaf is not simulated");
        }
        return super.node(n, ctx);
      case "tryCatch": {
        const [tb, cb] = n.blocks;
        try {
          this.block(tb.blocks, ctx);
        } catch (e) {
          if (isStop(e)) throw e;
          ctx.caught.push(n.id + ": " + e.message);
          this.block(cb.blocks, ctx);
        }
        return;
      }
      case "code-node": {
        const t0 = Date.now();
        const r = super.node(n, ctx);
        ctx.maxCodeMs = Math.max(ctx.maxCodeMs || 0, Date.now() - t0);
        return r;
      }
      case "sql-node": {
        const text = this.injectRaw(d.script.code, ctx);
        const rows = this.w.sql(n.id, text, ctx, this);
        this.record(n, ctx, rows);
        return;
      }
      case "get-node":
      case "search-node": {
        const got = this.w.read(n, ctx, this);
        this.record(n, ctx, got);
        return;
      }
      case "add-node":
      case "update-node": {
        const table = d.table_id.source.split(":Table:")[0];
        const props = (d.props.list || []).map((p) => [p.prop, p.valueType === "value" ? p.value : this.value(p.value, ctx)]);
        let count;
        let ids = null;
        if (n.type === "update-node") {
          const w = this.value(d.table_id.rules.list[0].value, ctx);
          ids = Array.isArray(w) ? Array.from(w) : w === undefined || w === null || w === "" ? [] : [w];
          count = ids.length;
        } else {
          const lens = props.filter(([, v]) => v instanceof Mapped).map(([, v]) => v.length);
          count = lens.length ? Math.max(...lens) : 1;
        }
        const rows = [];
        for (let i = 0; i < count; i++) {
          const r = {};
          for (const [p, v] of props) r[p] = v instanceof Mapped ? v[i] : v;
          if (ids) r.__id = ids[i];
          rows.push(r);
        }
        ctx.inBytes += JSON.stringify(rows).length;
        const out = n.type === "add-node" ? this.w.insert(table, rows, n.id, ctx) : this.w.update(table, rows, n.id, ctx);
        this.record(n, ctx, out);
        this.w.wrote(ctx.name + " " + n.id + " (" + table + " x" + rows.length + ")");
        return;
      }
      case "atomic-count-node": {
        const out = this.w.atomicCount(n, ctx, this);
        this.record(n, ctx, out);
        this.w.wrote(ctx.name + " " + n.id + " (atomic)");
        return;
      }
      case "workflow-node": {
        const [name, id] = d.workflow.source.split(":Workflow:");
        if (this.byId[id] !== name) throw new Error(n.id + " calls " + name + " with the id " + id + " (ids.json names " + (this.byId[id] || "no workflow") + ")");
        const params = {};
        for (const b of d.body_params.list) params[b.prop] = this.value(b.value, ctx);
        const copy = JSON.parse(JSON.stringify(params));
        this.calls.push({ from: ctx.name, to: name, node: n.id, run: ctx.run, params: this.w.keepCallParams ? copy : undefined, mode: copy.mode, op: copy.operation_key,
          n: Array.isArray(copy.movements) ? copy.movements.length : undefined });
        if (this.w.hooks[name]) this.w.hooks[name](copy, n, ctx);
        let returned;
        if (this.docs[name]) {
          const r = this.run(name, params);
          const rec = this.runs.filter((x) => x.run === r.ctx.run)[0];
          if (rec && rec.caught.length) throw new Error(n.id + ": the child " + name + " ended with a caught error (" + rec.caught[0] + ")");
          returned = r.returned || {};
        } else returned = this.w.child(name, copy, this);
        this.record(n, ctx, returned);
        return;
      }
      default:
        return super.node(n, ctx);
    }
  }
}

// one top-level call (a request chain): { out, err, runs, calls }
function call(world, docs, ids, name, params) {
  const e = new Interp(world, docs, ids);
  world.beginChain();
  let out = null;
  let err = null;
  try {
    const r = e.run(name, params);
    out = r.returned;
    const top = e.runs[0];
    if (top && top.caught.length) err = "caught: " + top.caught.join(" | ");
  } catch (x) {
    err = x.message;
  }
  world.endChain();
  return { out: out, err: err, runs: e.runs, calls: e.calls };
}

module.exports = { Interp, call };
