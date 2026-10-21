// End-to-end interpreter (copied from scratchpad/pi2k/sim/engine.js) for SI_SAVE / GD_Convert_SI / SO_Convert_SI, old and lean.
// Emulates: JSON-text injection into code, raw-text injection into SQL / if expressions, response_json filtering, array
// projection of props (rows.field), if (Expression / ConditionRule), condition-or (first true item), condition-all, loop,
// workflow-node (sub-workflows mocked by the world), slot, end-node outcomes. Records every write and, for every node whose
// output a later placeholder reads (the nodes the platform keeps in nodes_data), the size of its request + response.
"use strict";
const L = require("./lib.js");

class Stop {
  constructor(outcome) {
    this.outcome = outcome;
  }
}

function referencedIds(doc) {
  const text = JSON.stringify(doc);
  const ids = new Set();
  for (const m of text.matchAll(/\{\{node:([A-Za-z0-9_]+)/g)) ids.add(m[1]);
  for (const m of text.matchAll(/"prop":"node\.([A-Za-z0-9_]+)\./g)) ids.add(m[1]);
  for (const m of text.matchAll(/"node_ids":\["([A-Za-z0-9_]+)"\]/g)) ids.add(m[1]);
  return ids;
}

class Engine {
  constructor(doc, world, opts) {
    this.doc = doc;
    this.world = world;
    this.opts = opts || {};
    this.recorded = referencedIds(doc);
  }

  run(params) {
    const ctx = { params: params, out: {}, loops: {}, system: { tenantId: this.world.tenantId }, global: { nickname: null } };
    this.ctx = ctx;
    this.sizes = {};
    this.writes = [];
    this.order = [];
    let outcome = null;
    try {
      this.block(this.doc.nodes, ctx);
    } catch (e) {
      if (e instanceof Stop) outcome = e.outcome;
      else throw e;
    }
    return { outcome, writes: this.writes, sizes: this.sizes, order: this.order, ctx };
  }

  size(n, inText, out) {
    if (!this.recorded.has(n.id) && n.type !== "end-node") return;
    const outText = JSON.stringify({ code: 200, data: out === undefined ? null : out, msg: "操作成功", success: true });
    const s = this.sizes[n.id] || { in: 0, out: 0, runs: 0 };
    s.in += inText.length;
    s.out += outText.length;
    s.runs++;
    this.sizes[n.id] = s;
  }

  value(text, ctx) {
    const m = String(text).match(/^\{\{([^}]+)\}\}$/);
    if (m) return L.resolve(m[1], ctx);
    if (String(text).includes("{{")) return L.injectRaw(String(text), ctx);
    return text;
  }

  expr(code, ctx) {
    const src = L.injectRaw(code, ctx);
    try {
      return new Function("return (" + src + ");")();
    } catch (e) {
      throw new Error("expression failed: " + src);
    }
  }

  leafTrue(leaf, ctx) {
    const v = L.resolve(leaf.prop.replace(/^node\./, "node:"), ctx);
    if (leaf.operator === "equal") return String(v) === String(leaf.value);
    if (leaf.operator === "numberEqual") return v !== undefined && v !== null && v !== "" && Number(v) === Number(leaf.value);
    throw new Error("filter operator " + leaf.operator);
  }

  block(nodes, ctx) {
    for (const n of nodes || []) this.node(n, ctx);
  }

  node(n, ctx) {
    const d = n.data || {};
    this.order.push(n.id);
    switch (n.type) {
      case "start-node":
        return;
      case "code-node": {
        const used = {};
        const kept = L.runCode(d.script.code, ctx, L.declared(n), used);
        ctx.out[n.id] = { data: kept };
        this.size(n, JSON.stringify({ code: d.script.code, variableMap: used }), kept);
        return;
      }
      case "sql-node": {
        const text = L.injectRaw(d.script.code, ctx);
        const fn = this.world.sql[n.id];
        if (!fn) throw new Error("no sql mock " + n.id);
        const rows = fn(text, ctx, this.world);
        ctx.out[n.id] = { data: rows };
        this.size(n, JSON.stringify({ sql: text }), rows);
        return;
      }
      case "get-node":
      case "search-node": {
        const fn = this.world.read[n.id];
        if (!fn) throw new Error("no read mock " + n.id);
        const leaves = [];
        (function walk(list) {
          for (const r of list || []) r.type === "branch" ? walk(r.children) : leaves.push(r);
        })(d.table_id.rules.list);
        const args = {};
        for (const l of leaves) if (l.prop) args[l.prop] = l.valueType === "value" ? l.value : this.value(l.value, ctx);
        const res = fn(args, ctx, this.world);
        ctx.out[n.id] = { data: res };
        this.size(n, JSON.stringify({ condition: args, fieldList: [], tableId: d.table_id.source }), res);
        return;
      }
      case "add-node":
      case "update-node": {
        const table = d.table_id.source.split(":Table:")[0];
        const props = (d.props.list || []).map((p) => [p.prop, p.valueType === "value" ? p.value : this.value(p.value, ctx)]);
        const lens = props.filter(([, v]) => v instanceof L.Mapped).map(([, v]) => v.length);
        const count = lens.length ? Math.max(...lens) : 1;
        const rows = [];
        for (let i = 0; i < count; i++) {
          const r = {};
          for (const [p, v] of props) r[p] = v instanceof L.Mapped ? v[i] : v;
          rows.push(r);
        }
        if (n.type === "update-node" && !props.some(([p]) => p === "id")) {
          // addressed by its WHERE (props without id): the leaf's id value
          const leaf = (d.table_id.rules.list || [])[0] || {};
          const w = this.value(leaf.value, ctx);
          const ids = Array.isArray(w) ? Array.from(w) : [w];
          if (rows.length === 1 && ids.length === 1) rows[0].id = ids[0];
        }
        if (this.opts.maxRowsPerWrite && rows.length > this.opts.maxRowsPerWrite) throw new Error(n.id + " writes " + rows.length + " rows in one call");
        const res = n.type === "add-node" ? this.world.add(table, rows, n.id) : this.world.update(table, rows, n.id);
        this.writes.push({ node: n.id, kind: n.type, table: table, rows: rows });
        ctx.out[n.id] = { data: res };
        if (n.type === "add-node") this.size(n, JSON.stringify({ data: rows, tableId: d.table_id.source }), res);
        return;
      }
      case "delete-node": {
        const src = (d.node_ids || [])[0];
        const res = ctx.out[src] ? ctx.out[src].data : null;
        const rows = res && Array.isArray(res.data) ? res.data : res && res.data ? [res.data] : [];
        this.world.del(rows, n.id);
        this.writes.push({ node: n.id, kind: "delete", rows: rows.map((r) => ({ id: r.id })) });
        return;
      }
      case "if": {
        let ok;
        if (d.condition_type === "ConditionRule") ok = this.leafTrue(d.filter.list[0], ctx);
        else ok = !!this.expr(d.expression.code, ctx);
        this.block(n.blocks[ok ? 0 : 1].blocks, ctx);
        return;
      }
      case "condition-or-node": {
        let chosen = null;
        for (const item of n.blocks) {
          const id = item.data || {};
          if (id.isDefault) continue;
          const ok = id.condition_type === "Expression" ? !!this.expr(id.expression.code, ctx) : this.leafTrue(id.filter.list[0], ctx);
          if (ok) {
            chosen = item;
            break;
          }
        }
        if (!chosen) chosen = n.blocks.find((b) => (b.data || {}).isDefault) || null;
        if (chosen) this.block(chosen.blocks, ctx);
        return;
      }
      case "condition-all-node":
        for (const item of n.blocks) this.block(item.blocks, ctx);
        return;
      case "loop": {
        const list = L.resolve(d.loopSeletVar.code.replace(/^\{\{|\}\}$/g, ""), ctx) || [];
        for (const el of list) {
          ctx.loops[n.id] = el;
          this.block(n.blocks, ctx);
        }
        delete ctx.loops[n.id];
        return;
      }
      case "workflow-node": {
        const name = d.workflow.source.split(":Workflow:")[0];
        const params = {};
        for (const b of d.body_params.list) params[b.prop] = b.valueType === "value" ? b.value : this.value(b.value, ctx);
        const fn = this.world.wf[name];
        if (!fn) throw new Error("no sub-workflow mock " + name);
        const res = fn(params, this.world);
        this.writes.push({ node: n.id, kind: "workflow", name: name, params: params });
        ctx.out[n.id] = { data: res };
        this.size(n, JSON.stringify(params), res);
        return;
      }
      case "set-cache-node": {
        const k = this.value(d.redis_key, ctx);
        const raw = (d.custom_wkbocgni || {}).code;
        this.world.cache[k] = raw === undefined ? null : String(this.value(raw, ctx));
        ctx.out[n.id] = { data: true };
        return;
      }
      case "get-cache-node": {
        const k = this.value(d.redis_key, ctx);
        ctx.out[n.id] = { data: this.world.cache[k] === undefined ? null : this.world.cache[k] };
        return;
      }
      case "slot-node": {
        const res = this.world.slot(L.injectRaw(d.primary_key.code, ctx));
        ctx.out[n.id] = res;
        this.size(n, JSON.stringify({ tableId: "x", dataId: "x" }), res);
        return;
      }
      case "end-node": {
        if (d.back_data_type === "OutputParams") {
          const out = {};
          for (const f of (d.response_value || {}).list || []) out[f.prop] = this.value(f.value, ctx);
          throw new Stop({ code: 200, end: n.id, data: out });
        }
        throw new Stop({ code: d.code, end: n.id, msg: L.injectRaw((d.msg || {}).code || "", ctx) });
      }
      default:
        throw new Error("node type " + n.type + " (" + n.id + ")");
    }
  }
}

module.exports = { Engine, referencedIds };
