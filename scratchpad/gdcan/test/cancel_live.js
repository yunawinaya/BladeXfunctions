// cancel_live.js <reads dump.json> <tenant> <gd_id> [--json out.json]: gxChain (GOODS_DELIVERY's cancel + GD_UNUSED_FN_NEW's planner
// on the lifted bodies) on live dev reads (gdc test/run_prepare_sql.py). Prints what the classic cancel would write.
const fs = require("fs"), vm = require("vm");
const GDC = __dirname + "/../../gdc";
const [dump, tenant, gdId] = process.argv.slice(2);
const jsonAt = process.argv.indexOf("--json");
const S = JSON.parse(fs.readFileSync(dump, "utf8"));
const F = JSON.parse(fs.readFileSync(GDC + "/lift/fields.json", "utf8"));
const src = [GDC + "/lift/runtime.js", GDC + "/lift/lifted_prepare.js", GDC + "/code/prepare/adapter.js", GDC + "/code/prepare/chain.js", __dirname + "/../code/prepare/chain.js"]
  .map((f) => fs.readFileSync(f, "utf8")).join("\n");
const sb = { console, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
vm.createContext(sb);
vm.runInContext(src + `\nconst GC_KINDS = ${JSON.stringify({ header: F.goods_delivery, line: F.goods_delivery_fwii8mvb_sub })};`, sb);
sb.__S = S;
sb.__T = tenant;
const t0 = Date.now();
const out = vm.runInContext(`(() => {
  const R = gcAdapt(__S);
  const o = gxChain({ params: gxParams(R.gd.data), reads: R, tenantId: __T, uuid: "GDX1", kinds: GC_KINDS });
  const H = (k) => __withContext(o.ctx.head, () => __v(k));
  const C = (k) => __withContext(o.ctx.callee, () => __v(k));
  return { route: o.route, code: o.code, message: o.message, ran: o.ran.length, write: o.write, exec: o.unused && o.unused.exec, pick: o.unused && o.unused.pick,
    fill: H("node:code_node_IyJHrBst.data"), pickStatus: H("node:code_node_8pN1MyXz.data"), soFinal: H("node:code_node_UMQapdjk.data"), soHdr: H("node:code_node_lwB2FVe0.data"),
    hdrSync: H("node:code_pick_hdr_sync.data"), dates: H("node:code_node_62FzZA2e.data"), ob: C("node:code_node_OBz5tEws.data"), gdData: H("node:code_node_Pgtw6zFL.data.gdData.delivery_no") };
})()`, sb);
const ms = Date.now() - t0;
console.log(`route=${out.route} code=${out.code} ${out.message} | ${ms} ms | ${out.ran} nodes`);
if (out.write) console.log("GD write header:", JSON.stringify({ delivery_no: out.write.header.delivery_no, gd_status: out.write.header.gd_status, picking_status: out.write.header.picking_status, gd_total: out.write.header.gd_total }));
console.log("Pgtw6zFL delivery_no:", out.gdData, "| fill gd_status/picking/packing:", out.fill && [out.fill.gd_status, out.fill.picking_status, out.fill.packing_status, out.fill.needCL, out.fill.needSOCleanUp].join(" / "));
console.log("8pN1MyXz:", JSON.stringify(out.pickStatus));
if (out.exec) {
  const ex = out.exec;
  console.log("movements:", (ex.inventoryMovements || []).length, JSON.stringify((ex.inventoryMovements || []).slice(0, 3).map((m) => ({ t: m.movement_type, q: m.quantity, bin: m.bin_location, batch: m.batch_id, hu: m.handling_unit_id, src: m.source }))));
  console.log("reservation updates:", (ex.reservedRecordUpdates || []).length, JSON.stringify((ex.reservedRecordUpdates || []).slice(0, 3).map((u) => ({ id: u.id, status: u.status, rq: u.reserved_qty, oq: u.open_qty, dq: u.delivered_qty, tgt: u.target_gd_id, doc_no: u.doc_no }))));
  console.log("reservation creates:", (ex.reservedRecordCreates || []).length, JSON.stringify((ex.reservedRecordCreates || []).slice(0, 3)));
  console.log("hu updates:", (ex.huUpdates || []).length, "| exec keys:", Object.keys(ex).join(","));
}
console.log("OBz5tEws:", JSON.stringify(out.ob || {}).slice(0, 300));
console.log("xVqrs3Yi:", JSON.stringify(out.pick || {}).slice(0, 300));
console.log("SO final:", JSON.stringify(out.soFinal || {}).slice(0, 400));
console.log("SO headers:", JSON.stringify(out.soHdr || {}).slice(0, 400));
console.log("picking header sync:", JSON.stringify(out.hdrSync || {}).slice(0, 300));
console.log("item dates:", JSON.stringify(out.dates || {}).slice(0, 200));
if (jsonAt > 0) fs.writeFileSync(process.argv[jsonAt + 1], JSON.stringify(out));
