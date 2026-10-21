// peek_order.js <cache dir>: for every multi-document search output in the cached conversion runs, which order the documents came in
// (request ids order, id asc, id desc, other) - read-only over the cache.
"use strict";
const fs = require("fs");
const path = require("path");
const L = require("./lib.js");
const cache = process.argv[2];
const stat = {};
const samples = [];
for (const f of fs.readdirSync(path.join(cache, "runs")).filter((x) => /_(GD|SO)_Convert_SI_\d+\.json$/.test(x))) {
  const r = JSON.parse(fs.readFileSync(path.join(cache, "runs", f), "utf8"));
  const req = L.parseJ(r.request_json_data) || {};
  const p = req.workflowparams || req.request_json || {};
  const reqIds = (Array.isArray(p.ids) ? p.ids : Array.isArray(p.so_ids) ? p.so_ids : []).map(String);
  for (const x of L.parseJ(r.nodes_data) || []) {
    if (!x || !/^search_node_(AHtHRmqi|bOF3TVA2|Ivek0yYx)$/.test(x.node_id || "")) continue;
    const o = L.parseJ(x.response_json_data);
    const rows = o && o.data && Array.isArray(o.data.data) ? o.data.data : [];
    if (rows.length < 2) continue;
    const ids = rows.map((d) => String(d.id));
    const asc = ids.every((v, i) => i === 0 || BigInt(ids[i - 1]) < BigInt(v));
    const desc = ids.every((v, i) => i === 0 || BigInt(ids[i - 1]) > BigInt(v));
    const inReq = reqIds.filter((v) => ids.includes(v));
    const reqOrder = inReq.length === ids.length && inReq.every((v, i) => v === ids[i]);
    const ct = rows.map((d) => d.create_time || "");
    const ctAsc = ct.every((v, i) => i === 0 || ct[i - 1] <= v);
    const ctDesc = ct.every((v, i) => i === 0 || ct[i - 1] >= v);
    const k = (f.includes("GD_") ? "GD." : "SO.") + x.node_id.slice(-8) + " " + [asc ? "idAsc" : "", desc ? "idDesc" : "", reqOrder ? "reqOrder" : "", ctAsc ? "ctAsc" : "", ctDesc ? "ctDesc" : ""].filter(Boolean).join("+");
    stat[k] = (stat[k] || 0) + 1;
    if (!asc && samples.length < 6) samples.push(f + " " + x.node_id + " ids=" + ids.map((v) => v.slice(-5)).join(",") + " req=" + reqIds.map((v) => v.slice(-5)).join(",") + " ct=" + ct.join("|"));
  }
}
for (const k of Object.keys(stat).sort()) console.log(k.padEnd(50), stat[k]);
for (const s of samples) console.log("  " + s);
