// live_req.js <reads.json> <out_request.json> <n>: a GD_EDIT_SUBMIT FORM request for a live test (+ <out>.classic.json, the same
// edit as GOODS_DELIVERY's params) - the GD as stored (the
// PREPARE reads, as the form loads it) with n allocated lines' quantity lowered by 1, as GDgdQty.js would update them
// (gd_qty, base_qty, gd_delivered_qty, gd_undelivered_qty, the last temp_qty_data entry). Writes the request and
// <out_request.json>.changes.json (the lines and their before / after) for the checker. Tenant data: session scratchpad only.
// --remove=<k,...>: also drop those top-level lines (1-based, the form's order), as the row delete does; the changes file keeps
// each removed row. --add-from=<changes.json>: also append a fresh line for each row an earlier --remove dropped (the fields a
// line converted from its SO line carries, no allocation: the save allocates it). --set=<k>:<qty>,...: also set those lines'
// quantity (a raise adds to the last allocation entry, the same bin; use n = 0).
const fs = require("fs"), vm = require("vm");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const D = __dirname + "/..";
const pos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flag = (k) => (process.argv.slice(2).find((a) => a.startsWith("--" + k + "=")) || "").slice(k.length + 3);
const [readsFile, outFile, nArg] = pos;
const n = Number(nArg || 3);
const step = Number(pos[3] || 1);   // how much each line drops
const removeAt = flag("remove").split(",").filter(Boolean).map(Number);
const addFrom = flag("add-from");
const setAt = flag("set").split(",").filter(Boolean).map((x) => x.split(":").map(Number));
const S = JSON.parse(fs.readFileSync(readsFile, "utf8"));
const F = JSON.parse(fs.readFileSync(R + "scratchpad/gdc/lift/fields.json", "utf8"));
const sb = { console, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
vm.createContext(sb);
vm.runInContext([R + "scratchpad/gdc/lift/runtime.js", D + "/lift/lifted_edit.js", R + "scratchpad/gdc/code/prepare/chain.js", R + "scratchpad/gdc/code/prepare/adapter.js",
  D + "/code/prepare/chain_edit.js", D + "/code/prepare/adapter_edit.js"].map((f) => fs.readFileSync(f, "utf8")).join("\n") +
  "\nconst GE_KINDS = " + JSON.stringify({ header: F.goods_delivery, line: F.goods_delivery_fwii8mvb_sub }) + ";", sb);
sb.__S = S;
const stored = JSON.parse(JSON.stringify(vm.runInContext("geAdapt(__S).stored", sb)));
if (!stored || (stored.gd_status !== "Created" && stored.gd_status !== "Draft")) throw new Error("the GD is not Created or Draft: " + (stored && stored.gd_status));
// a Draft's lines carry no allocation yet: its edit is the header-only one, and the save allocates
if (stored.gd_status === "Draft" && n !== 0) throw new Error("a Draft takes the header-only edit (n = 0)");
const form = JSON.parse(JSON.stringify(stored));
const parse = (t) => { try { const v = JSON.parse(t || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
const rows = form.table_gd.flatMap((r) => [r].concat(r.children || []));
const changes = [];
const setQty = (l, t, qty) => {
  const delta = qty - Number(l.gd_qty);
  const was = { gd_qty: l.gd_qty, base_qty: l.base_qty, gd_delivered_qty: l.gd_delivered_qty, gd_undelivered_qty: l.gd_undelivered_qty, temp_qty_data: l.temp_qty_data };
  const factor = Number(l.gd_qty) ? Number(l.base_qty) / Number(l.gd_qty) : 1;
  l.gd_qty = qty;
  l.base_qty = Number((l.gd_qty * factor).toFixed(8));
  l.gd_delivered_qty = Number(l.gd_delivered_qty) + delta;
  l.gd_undelivered_qty = Number(l.gd_undelivered_qty) - delta;
  // the allocation shrinks from its last entry backwards (an emptied entry is dropped)
  let left = -delta;
  for (let i = t.length - 1; i >= 0 && left > 0; i--) { const take = Math.min(left, Number(t[i].gd_quantity)); t[i].gd_quantity = Number(t[i].gd_quantity) - take; left -= take; }
  if (delta > 0) t[t.length - 1].gd_quantity = Number(t[t.length - 1].gd_quantity) + delta;
  t.splice(0, t.length, ...t.filter((e) => Number(e.gd_quantity) > 0));
  l.temp_qty_data = JSON.stringify(t);
  changes.push({ id: String(l.id), material_id: String(l.material_id), so_line_item_id: String(l.so_line_item_id || ""), before: was,
    after: { gd_qty: l.gd_qty, base_qty: l.base_qty, gd_delivered_qty: l.gd_delivered_qty, gd_undelivered_qty: l.gd_undelivered_qty, temp_qty_data: l.temp_qty_data } });
};
for (const l of rows) {
  if (changes.length >= n) break;
  const t = parse(l.temp_qty_data);
  if (!l.material_id || !t.length || Number(l.gd_qty) <= step || t.reduce((k, e) => k + Number(e.gd_quantity), 0) < step) continue;
  setQty(l, t, Number(l.gd_qty) - step);
}
if (changes.length < n) throw new Error("only " + changes.length + " line(s) fit");
for (const [k, qty] of setAt) {
  const l = form.table_gd[k - 1];
  const t = l ? parse(l.temp_qty_data) : [];
  if (!l || !l.material_id || !t.length || !(qty > 0) || t.reduce((a, e) => a + Number(e.gd_quantity), 0) < Number(l.gd_qty) - qty) throw new Error("line " + k + " cannot take " + qty);
  setQty(l, t, qty);
}
for (const k of removeAt.slice().sort((a, b) => b - a)) {
  if (!(k >= 1 && k <= form.table_gd.length)) throw new Error("no line " + k);
  const [row] = form.table_gd.splice(k - 1, 1);
  changes.push({ removed: row });
}
// a fresh line, as converting its SO line makes it (SO_AUTO_GD's recorded Draft lines carry exactly these)
const FRESH = ["material_id", "material_name", "gd_material_desc", "more_desc", "line_remark_1", "line_remark_2", "line_remark_3", "custom_fields", "item_category_id",
  "unit_price", "total_price", "line_so_no", "line_so_id", "so_line_item_id", "is_internal", "base_uom_id", "item_costing_method", "project_id", "gd_order_quantity",
  "gd_order_uom_id", "good_delivery_uom_id", "gd_qty", "base_qty", "packing_uom", "packing_conversion", "packing_qty", "weight_conversion", "net_weight"];
if (addFrom) {
  for (const c of JSON.parse(fs.readFileSync(addFrom, "utf8")).filter((c) => c.removed)) {
    const row = {};
    for (const k of FRESH) if (c.removed[k] !== undefined) row[k] = c.removed[k];
    Object.assign(row, { gd_delivered_qty: 0, gd_initial_delivered_qty: 0, gd_undelivered_qty: Number(row.gd_order_quantity), temp_qty_data: null, temp_hu_data: null, view_stock: null });
    form.table_gd.push(row);
    changes.push({ added: row });
  }
}
// n = 0 alone, or a 5th positional argument "remark": the header's remark changes too
if ((n === 0 && !removeAt.length && !addFrom && !setAt.length) || pos[4] === "remark") { const was = form.order_remark; form.order_remark = (was || "") + " (GD Edit V2 live test)"; changes.push({ header: "order_remark", before: was === undefined ? null : was, after: form.order_remark }); }
const req = { operation: "SUBMIT", gd_id: String(stored.id), source: "FORM", answers: { needCL: "required", continueZero: "", confirmPickReversal: "" }, form: form };
fs.writeFileSync(outFile, JSON.stringify(req));
fs.writeFileSync(outFile + ".changes.json", JSON.stringify(changes, null, 1));
// the same edit through the classic save (a twin's oracle): GOODS_DELIVERY's params, as the form sends them
fs.writeFileSync(outFile + ".classic.json", JSON.stringify({ allData: form, saveAs: "Created", pageStatus: "Edit", needCL: "required", continueZero: "", confirmPickReversal: "" }));
console.log("request " + (JSON.stringify(req).length / 1e6).toFixed(2) + " MB; changes: " + changes.map((c) => (c.header ? "header " + c.header : c.removed ? "removed " + c.removed.id + " (" + c.removed.material_id + ")" : c.added ? "added SO line " + c.added.so_line_item_id + " (" + c.added.material_id + ") qty " + c.added.gd_qty : c.id + " gd_qty " + c.before.gd_qty + "->" + c.after.gd_qty)).join("; "));
