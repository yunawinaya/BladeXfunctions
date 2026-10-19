// Picking V2 1c: code/replan.js (grPlan, GD_REPLAN's planner) on GD Edit V2's LIFTED code against recorded classic runs of
// GOODS_DELIVERY called by PICKING (isPicking "Yes"). For each fixture:
// - pass 1: the chain sees the GD classic re-read (post-move, get_node_xTRvHWB8) with no cells;
// - pass 2: the GD before the pick (the PICKING run's search_node_krPmTbfL lines) + move.js's cells + classic's statuses;
// both must give the recorded planner's reservation updates / creates and stock movements (code_node_QrF4F4Hx), zero
// reorder deltas, no line inserted or deleted, and (pass 2) the moved lines' new allocation in the line patches.
// A recording whose planner code is not dev's (GDinventoryProcessWorkflow.json = GD_UNUSED_FN_NEW v55) is reported, not failed.
// usage: node test_replan_parity.js <dir with gd/ and pick/>
const fs = require("fs"), vm = require("vm"), path = require("path");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const GDE = R + "scratchpad/gde/";
const P = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== null && v[k] !== undefined).map((k) => [k, canon(v[k])])) : v);
const F = JSON.parse(fs.readFileSync(R + "scratchpad/gdc/lift/fields.json", "utf8"));
const KINDS = { header: F.goods_delivery, line: F.goods_delivery_fwii8mvb_sub };
const MODS = [R + "scratchpad/gdc/lift/runtime.js", GDE + "lift/lifted_edit.js", R + "scratchpad/gdc/code/prepare/chain.js", R + "scratchpad/gdc/code/prepare/adapter.js",
  GDE + "code/prepare/alloc_edit.js", GDE + "code/prepare/chain_edit.js", GDE + "code/submit/delta.js", GDE + "code/prepare/apply_delta.js", GDE + "code/prepare/plan_edit.js",
  GDE + "code/commit/so_edit.js", GDE + "code/prepare/adapter_edit.js"];
const SRC = MODS.map((f) => fs.readFileSync(f, "utf8")).join("\n") + "\nconst GE_KINDS = " + JSON.stringify(KINDS) + ";\n" +
  fs.readFileSync(process.env.REPLAN_JS || path.join(__dirname, "..", "code", "replan.js"), "utf8");
const pkMovePlan = new Function(fs.readFileSync(path.join(__dirname, "..", "code", "move.js"), "utf8") + "\nreturn pkMovePlan;")();
const RES_COLS = ["target_gd_id", "status", "reserved_qty", "open_qty", "delivered_qty", "doc_no", "doc_id", "doc_line_id", "source_reserved_id", "item_uom"];
const S0 = { total: 0, count: 0, data: [] }, G0 = { count: 0, data: {} };

// dev's planner nodes (the lifted v55): a recording made with other code is drift, not a failure
const devNodes = {};
(function walk(ns) { for (const n of ns || []) { if (n.data && n.data.script) devNodes[n.id] = n.data.script.code; walk(n.blocks); } })(
  JSON.parse(fs.readFileSync(R + "Goods Delivery/GDinventoryProcessWorkflow.json", "utf8")).nodes);
const PLANNER = ["code_node_SSWylCan", "code_node_eOMvMZOj", "code_node_b71wypDJ", "code_node_QrF4F4Hx"];

let fails = 0, oks = 0, drift = 0;
const check = (label, cond, extra) => { if (cond) oks++; else { fails++; console.log("FAIL " + label + (extra === undefined ? "" : "  " + JSON.stringify(extra).slice(0, 700))); } };
// on a difference, the differing paths (first 6), not the whole values
const diffPaths = (a, b, p, out) => {
  if (out.length >= 6 || JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a && b && typeof a === "object" && typeof b === "object") { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffPaths(a[k], b[k], p + "." + k, out); }
  else out.push(p + ": got " + JSON.stringify(a) + " want " + JSON.stringify(b));
  return out;
};
const same = (label, got, want) => { const g = canon(got), w = canon(want); check(label, JSON.stringify(g) === JSON.stringify(w), diffPaths(g, w, "", [])); };

function plan(IN, Rd, at) {
  const sb = { console: { log() {}, error() {} }, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp,
    Date: class extends Date { constructor(...a) { if (a.length) super(...a); else super(at); } static now() { return at; } } };
  vm.createContext(sb);
  vm.runInContext(SRC, sb);
  sb.__IN = IN; sb.__R = Rd; sb.__K = KINDS;
  return JSON.parse(JSON.stringify(vm.runInContext("grPlan(__IN, __R, __K)", sb)));
}

// the planner's inventoryMovements as INVENTORY_BULK_APPLY movements (condition_or_node_zvMyWcqT's mapping, written out again here)
function expectMovements(list, gd) {
  const out = [];
  (list || []).forEach((m, i) => {
    const c = { plant_id: String(gd.plant_id), organization_id: String(gd.organization_id), material_id: String(m.material_id), quantity: m.quantity, material_uom: m.material_uom || null,
      transaction_type: "GDL", trx_no: String(gd.delivery_no), parent_trx_no: m.line_so_no || null, location_id: String(m.bin_location), batch_id: m.batch_id || null,
      doc_date: String(gd.delivery_date), handling_unit_id: m.handling_unit_id || "" };
    const k = "M" + (i + 1), t = m.movement_type;
    const one = (x) => out.push(Object.assign({}, c, x));
    if (t === "RESERVED_SUBTRACT_CROSS_BIN") one({ movement_key: k, direction: "SUBTRACT", inventory_category: "Reserved", isMovingInv: 1 });
    else if (t === "RESERVED_ADD_CROSS_BIN") one({ movement_key: k, direction: "ADD", inventory_category: "Reserved", isMovingInv: 1 });
    else if (t === "UNRESTRICTED_TO_RESERVED") { one({ movement_key: k, direction: "SUBTRACT", inventory_category: "Unrestricted", isMovingInv: 1 }); one({ movement_key: k + ".2", direction: "ADD", inventory_category: "Reserved", isMovingInv: 1, unit_price_from: k }); }
    else if (t === "RESERVED_TO_UNRESTRICTED") { one({ movement_key: k, direction: "SUBTRACT", inventory_category: "Reserved", isMovingInv: 1 }); one({ movement_key: k + ".2", direction: "ADD", inventory_category: "Unrestricted", isMovingInv: 1, unit_price_from: k }); }
    else out.push({ unexpected: t });
  });
  return out;
}
const proj = (o) => { const x = {}; for (const c of RES_COLS) x[c] = o[c] === undefined ? null : o[c]; return x; };
const stripCreate = (c) => { const x = Object.assign({}, c); delete x.reserved_date; delete x.plant_id; delete x.organization_id; return x; };

const dir = process.argv[2];
for (const f of fs.readdirSync(path.join(dir, "gd")).filter((x) => x.endsWith(".json")).sort()) {
  const fx = JSON.parse(fs.readFileSync(path.join(dir, "gd", f), "utf8"));
  const pk = JSON.parse(fs.readFileSync(path.join(dir, "pick", f), "utf8"));
  const rec = {}, code = {};
  for (const src of [fx.head, fx.unused]) if (src) for (const x of JSON.parse(src.nodes_data || "[]")) if (x.node_id && rec[x.node_id] === undefined) {
    try { rec[x.node_id] = P(x.response_json_data || "{}").data; } catch (e) { /* skip */ }
    try { code[x.node_id] = (P(x.request_json_data || "{}") || {}).code; } catch (e) { /* skip */ }
  }
  const label = f.slice(0, 19) + " " + fx.tenant_id + " " + fx.doc_no;
  const drifted = PLANNER.filter((id) => code[id] && code[id] !== devNodes[id]);
  if (drifted.length) { drift++; console.log("note " + label + ": recorded with other planner code (" + drifted.join(", ") + "): compared, not failed"); }
  const before = fails;
  const params = P(fx.head.request_json_data).workflowparams;
  const post = rec["get_node_xTRvHWB8"] && rec["get_node_xTRvHWB8"].data;
  const g = (id, d) => (rec[id] === undefined ? d : rec[id]);
  const reads = (stored) => ({ stored: stored, serialItems: [], linkage: g("search_gr_linkage", S0), its: g("search_gr_its", S0), grSo: g("search_gr_so", S0),
    pickingSetup: g("get_node_iFPuvJX2", G0), itemFlags: g("sql_node_ItemFlags", []), packingSetup: g("get_packing_setup", G0), activePickings: g("search_node_NBAQ9gsj", S0),
    binNames: g("search_bin_names", S0), checkRequired: rec["workflow_node_0jaUJbQD"], soLines: g("search_node_SOLine8kQ2", S0), cleanupSoLines: g("search_node_DnZIKKVH", S0),
    soHeaders: g("search_node_FVhsTRDu", S0), pickingFormat: g("get_node_zna6o03F", G0), itemDatas: g("sql_node_ItemDatas", []), allocated: g("search_node_r3NiR6B7", S0),
    pending: g("search_node_QdY1FLLA", S0) });
  const at = Number((BigInt(fx.head.id) >> 22n) + 1288834974657n);
  const exec = rec["code_node_QrF4F4Hx"] || {};
  const want = { updates: (exec.reservedRecordUpdates || []).map((u) => [String(u.id), proj(u)]), creates: (exec.reservedRecordCreates || []).map((c) => canon(c)),
    movements: expectMovements(exec.inventoryMovements, post) };
  const verify = (tag, out) => {
    check(label + " " + tag + ": PLANNED", out.route === "PLANNED", { route: out.route, code: out.code, message: out.message });
    same(label + " " + tag + ": reservation updates", out.res_updates.map((u) => [u.id, u.after]), want.updates);
    // add_node_ojy0rTgC writes reserved_date / plant_id / organization_id from its params (doc_date = the GD's delivery_date), not the record
    same(label + " " + tag + ": reservation creates", out.res_creates.map(stripCreate), want.creates.map(stripCreate));
    same(label + " " + tag + ": creates stamped as the insert node stamps them", out.res_creates.map((c) => [c.reserved_date, c.plant_id, c.organization_id]),
      want.creates.map(() => [String(post.delivery_date), String(post.plant_id), String(post.organization_id)]));
    same(label + " " + tag + ": movements", out.movements, want.movements);
    same(label + " " + tag + ": reorder deltas", out.reorder, []);
    check(label + " " + tag + ": no line inserted / deleted", out.gdl_inserts === 0 && out.gdl_deletes === 0, { ins: out.gdl_inserts, del: out.gdl_deletes });
  };
  // classic itself saw zero reorder deltas (its REORDER_SET_REDIS call)
  const reo = fx.reorder ? (JSON.parse(fx.reorder.nodes_data || "[]").find((x) => x.node_id === "code_node_f8qELJUF") || null) : null;
  if (reo) same(label + ": classic reorder deltas", (P(reo.response_json_data || "{}").data || {}).data || [], []);

  const base = { gdId: String(post.id), organizationId: String(post.organization_id), tenantId: fx.tenant_id, isLoadingBay: Number(params.isLoadingBay) === 1 ? 1 : 0 };
  verify("pass 1", plan(Object.assign({}, base, { lines: [] }), reads(post), at));

  // pass 2: the GD before the pick, then the cells V2 sends
  const ies = JSON.parse(pk.picking.nodes_data).find((x) => x.node_id === "code_node_iES7iMKA");
  const vmap = P(ies.request_json_data).variableMap;
  const classicOut = P(ies.response_json_data).data;
  const preLines = {};
  for (const l of vmap["node:search_node_krPmTbfL.data.data"] || []) preLines[String(l.id)] = l;
  const pre = JSON.parse(JSON.stringify(post));
  const MOVED_CELLS = ["temp_qty_data", "prev_temp_qty_data", "view_stock", "picking_status"];
  const rows = (pre.table_gd || []).flatMap((r) => [r].concat(r.children || []));
  for (const r of rows) {
    const p = preLines[String(r.id)];
    if (!p) continue;
    for (const c of MOVED_CELLS) { if (p[c] === undefined || p[c] === null || p[c] === "") delete r[c]; else r[c] = p[c]; }
  }
  const mv = pkMovePlan({ records: vmap["node:code_node_oHIIKfiw.data.records"] || [], gdLines: vmap["node:search_node_krPmTbfL.data.data"] || [],
    locations: vmap["node:search_node_kUwlb6md.data.data"] || [], batches: vmap["node:search_node_kdhCN7Yu.data.data"] || [], hus: vmap["node:search_node_ko6ZYIQp.data.data"] || [] });
  const statusOf = {};
  for (const l of classicOut.updatedGdLines || []) statusOf[String(l.id)] = l.picking_status;
  const cells = mv.lines.filter((l) => l.gd_id === String(post.id)).map((l) => ({ id: l.id, cells: { temp_qty_data: l.temp_qty_data, prev_temp_qty_data: l.before_temp,
    view_stock: l.view_stock, picking_status: statusOf[l.id] } }));
  check(label + " pass 2: move.js moved a line of this GD", cells.length > 0, mv);
  const out2 = plan(Object.assign({}, base, { lines: cells }), reads(pre), at);
  verify("pass 2", out2);
  const patch = {};
  for (const p of out2.gdl_patches || []) patch[p.id] = p.cells;
  for (const l of mv.lines.filter((x) => x.gd_id === String(post.id))) {
    same(label + " pass 2: " + l.id + " allocation written", (patch[l.id] || {}).temp_qty_data, l.temp_qty_data);
    same(label + " pass 2: " + l.id + " prev_temp_qty_data = the new allocation (classic's final)", (patch[l.id] || {}).prev_temp_qty_data, l.temp_qty_data);
    same(label + " pass 2: " + l.id + " view_stock written as move.js built it", (patch[l.id] || {}).view_stock, l.view_stock);
  }
  console.log((fails === before ? "ok   " : "FAIL ") + label + " (" + (exec.inventoryMovements || []).length + " movements, " + want.updates.length + " updates, " + want.creates.length + " creates)");
}
console.log(JSON.stringify({ checks: oks + fails, failed: fails, drifted: drift }));
process.exit(fails ? 1 : 0);
