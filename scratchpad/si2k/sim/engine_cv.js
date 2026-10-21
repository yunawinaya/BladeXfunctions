// engine.js for the SI conversions: a set-cache-node whose value is an object or array keeps it as JSON text, the way Redis holds it
// (GD_Convert_SI parks its SI results list there between loop passes; engine.js's String(value) would store "[object Object]").
"use strict";
const { Engine, referencedIds } = require("./engine.js");

class CvEngine extends Engine {
  node(n, ctx) {
    if (n.type !== "set-cache-node") return super.node(n, ctx);
    const d = n.data || {};
    this.order.push(n.id);
    const k = this.value(d.redis_key, ctx);
    const raw = (d.custom_wkbocgni || {}).code;
    const v = raw === undefined ? null : this.value(raw, ctx);
    this.world.cache[k] = v === null || v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : String(v);
    ctx.out[n.id] = { data: true };
  }
}

module.exports = { Engine: CvEngine, referencedIds };
