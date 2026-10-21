// chain_live.js <reads.json>: code/prepare/chain.js on one GD's live dev reads (test/run_reads.py output, session scratchpad):
// the lifted revert nodes in the classic order. Prints the route and what the revert would write; exit 1 if it throws.
const fs = require("fs"), vm = require("vm");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const D = __dirname + "/..";
const X = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const sb = { console: { log() {}, error() {} }, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
vm.createContext(sb);
for (const f of [R + "scratchpad/gdc/lift/runtime.js", D + "/lift/lifted_revert.js", R + "scratchpad/gdc/code/prepare/adapter.js", D + "/code/prepare/chain.js"])
  vm.runInContext(fs.readFileSync(f, "utf8"), sb);
vm.runInContext("this.grReads = grReads; this.grChain = grChain;", sb);
const S = Object.assign({ organizationId: X.org }, X.reads);
const reads = sb.grReads(S);
if (!reads.gd.count) throw new Error("GD not found in the reads");
const out = sb.grChain(reads.gd.data, reads, "all");
const b = out.batch || {}, so = out.so || {}, ps = out.pickStatus || {};
console.log(JSON.stringify({
  route: out.route, code: out.code, message: out.message, conflicts: (out.conflicts || []).length,
  movements: (b.inventoryMovements || []).map((m) => [m.material_id, m.quantity, m.material_uom, m.location_id, m.batch_id, m.inventory_category, m.unit_price, m.parent_no]),
  reservedUpdates: (b.reservedUpdates || []).map((r) => [r.id, r.status, r.reserved_qty, r.open_qty, r.delivered_qty]),
  fragments: (b.fragmentSoftDeletes || []).length, pendingRestores: (b.pendingRestores || []).length, pickingRec: (b.pickingRecUpdates || []).length,
  pickingHdr: (b.pickingHdrUpdates || []).length, hu: (b.huUpdates || []).length,
  soLines: (so.soLineUpdates || []).map((u) => [u.id, u.planned_qty, u.delivered_qty, u.outstanding_quantity, u.line_status]),
  soHeaders: (so.soHeaderUpdates || []).map((u) => [u.id, u.so_status, u.gd_status, u.partially_delivered, u.fully_delivered]),
  pickStatus: { lines: (ps.lineUpdates || []).length, header: ps.headerPickingStatus, hasHeader: ps.hasHeaderUpdate },
}, null, 1));
