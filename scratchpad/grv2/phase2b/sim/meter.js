// The Picking V2 interpreter (../../sim/engine.js) plus: ConditionRule if-nodes (the pre-Phase-2 GR_CREATED has them),
// workflows loaded from any path, and a node-data meter that counts what the platform logs per node in nodes_data
// (code-node: code + one value per distinct placeholder + output; sql-node: the substituted SQL + rows; search / get:
// condition + rows; add / update / if / loop nodes are not logged there).
const fs = require("fs");
const path = require("path");
const { Engine } = require("../../sim/engine");

const ROOT = path.resolve(__dirname, "../../../..");
const PATHS = {
  GR_CREATED: path.join(ROOT, "Goods Receiving/GRsaveAsCreatedWorkflow.json"),
  GR_CANCEL_CREATED: path.join(ROOT, "Bulk Actions/Procurement/Goods Receiving/GRcancelWorkflow.json"),
  GR_CREATED_OLD: path.join(__dirname, "../base/GR_CREATED.v12.json"),
  GR_CANCEL_CREATED_OLD: path.join(__dirname, "../base/GR_CANCEL_CREATED.v7.json"),
};

class MeterEngine extends Engine {
  constructor(opts) {
    super(opts);
    this.meter = [];
    this.writeBytes = 0;
    // what a placeholder of a node that did not run becomes inside a code node: "null" (the old GR_CREATED relies on
    // it: {{node:search_origGR.data.data}} || [] on Add) or "" (stricter; the lean bodies must survive both)
    this.missing = opts.missing || process.env.GR_SIM_MISSING || "null";
    // {{system:uuid}} is unique per run on the platform: never repeat one across engine instances
    this.uuidN = MeterEngine.uuidBase;
    MeterEngine.uuidBase += 100000;
  }

  injectJs(text, ctx) {
    return text.replace(/\{\{([^}]+)\}\}/g, (_, ref) => {
      const v = this.resolve(ref, ctx);
      return v === undefined ? (this.missing === "null" ? "null" : "") : JSON.stringify(v);
    });
  }

  load(name) {
    return JSON.parse(fs.readFileSync(PATHS[name] || name, "utf8"));
  }

  ruleLeaf(leaf, ctx) {
    const prop = String(leaf.prop || "").replace(/^node\./, "node:").replace(/^workflowparams\./, "workflowparams:");
    const v = this.resolve(prop, ctx);
    switch (leaf.operator) {
      case "numberEqual": return v !== null && v !== undefined && Number(v) === Number(leaf.value);
      case "equal": return String(v) === String(leaf.value);
      case "notEqual": return String(v) !== String(leaf.value);
      case "isNotNull": return v !== null && v !== undefined;
      default: throw new Error("rule operator " + leaf.operator);
    }
  }

  rule(item, ctx) {
    if (item.type === "branch") {
      const kids = (item.children || []).map((c) => this.rule(c, ctx));
      return item.operator === "any" ? kids.some(Boolean) : kids.every(Boolean);
    }
    return this.ruleLeaf(item, ctx);
  }

  node(n, ctx) {
    const d = n.data || {};
    if (n.type === "if" && d.condition_type === "ConditionRule") {
      const ok = (d.filter.list || []).every((it) => this.rule(it, ctx));
      this.block(n.blocks[ok ? 0 : 1].blocks, ctx);
      return;
    }
    let req = 0;
    if (n.type === "code-node") {
      const seen = new Set();
      req = d.script.code.length;
      for (const m of d.script.code.matchAll(/\{\{([^}]+)\}\}/g)) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        const v = this.resolve(m[1], ctx);
        req += m[1].length + (v === undefined ? 0 : JSON.stringify(v).length);
      }
    } else if (n.type === "sql-node") {
      req = this.injectRaw(d.script.code, ctx).length;
    } else if (n.type === "search-node" || n.type === "get-node") {
      req = 300;
    } else if (n.type === "add-node" || n.type === "update-node") {
      // not in nodes_data; counted apart (the platform still holds and sends this payload)
      const props = (d.props.list || []).map((p) => (p.valueType === "value" ? p.value : this.value(p.value, ctx)));
      this.writeBytes += JSON.stringify(props).length;
    }
    // a search-node's configured limit is not applied by the platform (main session, 2026-10-14: 1,232 dev traces,
    // none truncated): read every row, so the old workflows are measured as they really run
    super.node(n.type === "search-node" && n.data && n.data.limit ? Object.assign({}, n, { data: Object.assign({}, n.data, { limit: 0 }) }) : n, ctx);
    if (["code-node", "sql-node", "search-node", "get-node", "return-node"].includes(n.type)) {
      const out = ctx.out[n.id];
      this.meter.push({ wf: ctx.name, id: n.id, req, resp: out === undefined ? 0 : JSON.stringify(out).length });
    }
  }

  nodeData(name) {
    return this.meter.filter((m) => !name || m.wf === name).reduce((s, m) => s + m.req + m.resp, 0);
  }
}

MeterEngine.uuidBase = 1;
module.exports = { MeterEngine, PATHS, ROOT };
