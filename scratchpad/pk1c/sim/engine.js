// Copied from scratchpad/gdc/pkv2tools/sim/engine.js (2026-10-16) for the stage 1c simulator (gdc/ is not edited), one change:
// run uuids differ in their first 8 characters, as the platform's random 32-hex uuids do (PREPARE's move nonce is taken from them);
// and node data counts the injected inputs too (sizesIn: a code node's placeholder values, a sub-workflow call's params), as nodes_data stores them.
// A small interpreter for BladeX workflow JSON, enough to run the Picking V2 workflows end to end against an in-memory DB.
// Emulates: placeholder injection (JSON text into code, raw text into SQL / keys / expressions), response_json filtering
// of code-node output, array-path props on add/update nodes, condition-or / condition-all / if / loop / cache / return,
// sub-workflow calls, and "the run stops at the first failed node".
const fs = require("fs");
const path = require("path");

class Stop {
  constructor(value) { this.value = value; }
}

// a run whose try-catch caught an error: complete, its writes kept, but failed for its caller (verified on dev 10-16 / 10-23)
class CaughtRun extends Error {
  constructor(name, caught, res) {
    super(name + ": a caught error marks the run - " + caught);
    this.res = res;
  }
}

// a value reached THROUGH an array (rows.id) is one value per row: the platform zips such props by index
class Mapped extends Array {}

function getPath(obj, parts) {
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    if (cur === undefined || cur === null) return undefined;
    if (Array.isArray(cur) && !/^\d+$/.test(parts[i])) {
      const rest = parts.slice(i);
      const out = new Mapped();
      for (const el of cur) out.push(getPath(el, rest));
      return out;
    }
    cur = cur[parts[i]];
  }
  return cur;
}

class Engine {
  constructor(opts) {
    this.dir = opts.dir;
    this.db = opts.db;
    this.mocks = opts.mocks;
    this.redis = {};
    this.trace = [];
    this.sizes = {};
    this.sizesIn = {};
    this.inByNode = {};
    this.faults = opts.faults || {};
    this.uuidN = 0;
  }

  load(name) {
    return JSON.parse(fs.readFileSync(path.join(this.dir, name + ".json"), "utf8"));
  }

  run(name, params) {
    const wf = this.load(name);
    const ctx = { name, params: params || {}, out: {}, loops: {}, uuid: (++this.uuidN).toString(16).padStart(8, "0") + "a".repeat(24), bytes: 0, bytesIn: 0 };
    let res;
    try {
      this.block(wf.nodes, ctx);
      res = { returned: null, ctx };
    } catch (e) {
      if (!(e instanceof Stop)) throw e;
      res = { returned: e.value, ctx };
    } finally {
      this.sizes[name] = Math.max(this.sizes[name] || 0, ctx.bytes);
      this.sizesIn[name] = Math.max(this.sizesIn[name] || 0, ctx.bytesIn);
    }
    // the platform: a caught error still marks the run, so its caller's workflow-node fails (the run's writes stay)
    if (ctx.caught) throw new CaughtRun(name, ctx.caught, res);
    return res;
  }

  resolve(ref, ctx) {
    const m = ref.match(/^(node|workflowparams|system|global):(.+)$/);
    if (!m) throw new Error("bad ref " + ref);
    const [, kind, p] = m;
    if (kind === "system") return p === "tenantId" ? this.db.tenantId : p === "uuid" ? ctx.uuid : undefined;
    if (kind === "workflowparams") return getPath(ctx.params, p.split("."));
    if (kind === "global") return undefined;
    const parts = p.split(".");
    const id = parts[0];
    if (ctx.loops[id] !== undefined) return getPath(ctx.loops[id], parts.slice(1));
    if (!(id in ctx.out)) return undefined;
    return getPath({ data: ctx.out[id] }, parts.slice(1));
  }

  // JSON text injection (code nodes, cache values)
  injectJs(text, ctx) {
    return text.replace(/\{\{([^}]+)\}\}/g, (_, ref) => {
      const v = this.resolve(ref, ctx);
      const t = v === undefined ? "" : JSON.stringify(v);
      ctx.bytesIn += t.length;
      return t;
    });
  }

  // raw text injection (SQL, redis keys, if expressions)
  injectRaw(text, ctx) {
    return text.replace(/\{\{([^}]+)\}\}/g, (_, ref) => {
      const v = this.resolve(ref, ctx);
      return v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    });
  }

  value(text, ctx) {
    // a prop value: a single placeholder resolves to its value; anything else is text
    const m = String(text).match(/^\{\{([^}]+)\}\}$/);
    if (m) return this.resolve(m[1], ctx);
    if (String(text).includes("{{")) return this.injectRaw(text, ctx);
    return text;
  }

  block(nodes, ctx) {
    for (const n of nodes || []) this.node(n, ctx);
  }

  record(n, ctx, data) {
    ctx.out[n.id] = data;
    const len = JSON.stringify(data === undefined ? null : data).length;
    ctx.bytes += len;
    this.trace.push(ctx.name + " " + n.id);
  }

  node(n, ctx) {
    const d = n.data || {};
    if (this.faults[n.id] && this.faults[n.id] > 0) {
      this.faults[n.id]--;
      throw new Error("injected fault at " + n.id);
    }
    switch (n.type) {
      case "start-node":
      case "end-node":
        return;
      case "code-node": {
        const before = ctx.bytesIn;
        const src = this.injectJs(d.script.code, ctx);
        this.inByNode[ctx.name + " " + n.id] = (this.inByNode[ctx.name + " " + n.id] || 0) + ctx.bytesIn - before;
        let res;
        try {
          res = new Function("console", src)({ log: () => {}, error: () => {} });
        } catch (e) {
          throw new Error("code node " + n.id + " failed: " + e.message);
        }
        const declared = (d.response_json || []).map((r) => r.name);
        const kept = {};
        for (const k of declared) if (res && k in res) kept[k] = JSON.parse(JSON.stringify(res[k] === undefined ? null : res[k]));
        this.record(n, ctx, kept);
        return;
      }
      case "sql-node": {
        const mock = this.mocks.sql[n.id];
        if (!mock) throw new Error("no SQL mock for " + n.id);
        const rows = mock(this.injectRaw(d.script.code, ctx), ctx, this);
        this.record(n, ctx, rows);
        return;
      }
      case "get-node":
      case "search-node": {
        const mock = this.mocks.read[n.id];
        if (!mock) throw new Error("no read mock for " + n.id);
        const leaf = d.table_id.rules.list[0];
        const v = this.value(leaf.value, ctx);
        let got = mock(v, ctx, this);
        // a main-table search limits the RECORD ids it selects (inner id subquery + LIMIT), so rows past the limit are lost
        const src = String(d.table_id.source || "");
        if (n.type === "search-node" && d.limit && !/_sub:Table:/.test(src) && got && Array.isArray(got.data) && got.data.length > d.limit) {
          got = Object.assign({}, got, { data: got.data.slice(0, d.limit), count: d.limit });
          this.truncated = (this.truncated || []).concat([n.id]);
        }
        this.record(n, ctx, got);
        return;
      }
      case "update-node":
      case "add-node": {
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
        const out = n.type === "add-node" ? this.db.insert(table, rows, ctx) : this.db.update(table, rows, ctx);
        this.record(n, ctx, out);
        return;
      }
      case "if": {
        const expr = this.injectRaw(d.expression.code, ctx);
        let ok;
        try {
          ok = new Function("return (" + expr + ");")();
        } catch (e) {
          throw new Error("if " + n.id + " expression failed: " + expr);
        }
        this.block(n.blocks[ok ? 0 : 1].blocks, ctx);
        return;
      }
      case "condition-or-node": {
        let chosen = null;
        for (const item of n.blocks) {
          const list = (item.data.filter || {}).list || [];
          if (item.data.isDefault) continue;
          const leaf = list[0];
          const v = this.resolve(leaf.prop.replace(/^node\./, "node:"), ctx);
          if (leaf.operator === "equal" && String(v) === String(leaf.value)) {
            chosen = item;
            break;
          }
        }
        if (!chosen) chosen = n.blocks.find((b) => b.data.isDefault) || null;
        if (chosen) this.block(chosen.blocks, ctx);
        return;
      }
      case "condition-all-node":
        for (const item of n.blocks) this.block(item.blocks, ctx);
        return;
      case "loop": {
        const list = this.resolve(d.loopSeletVar.code.replace(/^\{\{|\}\}$/g, ""), ctx) || [];
        for (const el of list) {
          ctx.loops[n.id] = el;
          this.block(n.blocks, ctx);
        }
        delete ctx.loops[n.id];
        return;
      }
      case "set-cache-node": {
        const k = this.injectRaw(d.redis_key, ctx);
        const v = new Function("return (" + this.injectJs(d.custom_wkbocgni.code, ctx) + ");")();
        this.redis[k] = v !== null && typeof v === "object" ? JSON.stringify(v) : String(v);
        this.record(n, ctx, null);
        return;
      }
      case "get-cache-node": {
        const k = this.injectRaw(d.redis_key, ctx);
        // the platform hands a stored array / number back as a value, not as text
        let v = this.redis[k] === undefined ? null : this.redis[k];
        if (typeof v === "string") {
          try {
            v = JSON.parse(v);
          } catch (e) {
            /* plain text */
          }
        }
        this.record(n, ctx, v);
        return;
      }
      case "workflow-node": {
        const callee = d.workflow.source.split(":Workflow:")[0];
        const params = {};
        for (const b of d.body_params.list) params[b.prop] = this.value(b.value, ctx);
        ctx.bytesIn += JSON.stringify(params).length;
        const r = this.run(callee, params);
        this.record(n, ctx, r.returned || {});
        return;
      }
      case "return-node": {
        const out = {};
        for (const f of d.response_value.list) out[f.prop] = this.value(f.value, ctx);
        throw new Stop(out);
      }
      case "tryCatch": {
        const [tryB, catchB] = n.blocks || [];
        try {
          this.block(tryB ? tryB.blocks : [], ctx);
        } catch (err) {
          if (err instanceof Stop) throw err;
          ctx.caught = ctx.caught || String(err.message || err).slice(0, 200);
          this.trace.push(ctx.name + " " + n.id + " caught: " + ctx.caught);
          this.block(catchB ? catchB.blocks : [], ctx);
        }
        return;
      }
      default:
        throw new Error("node type " + n.type + " not simulated (" + n.id + ")");
    }
  }
}

module.exports = { Engine, getPath, Mapped, CaughtRun };
