// Picking V2 1c: code/move.js (pkMovePlan) against classic PICKING code_node_iES7iMKA, which is the oracle:
// - every recorded prod run in <fixtures>/pick: the recorded classic code replays to its recorded output, and pkMovePlan
//   gives the same temp_qty_data / view_stock for every line it moves;
// - synthetic cases made by changing a recorded run's inputs, run through the same classic code.
// usage: node test_move.js <dir with pick/*.json>
const fs = require("fs");
const path = require("path");
const { runBody, eq, truthy, done } = require("../../gdc/pkv2tools/harness.js");

const big = (s) => JSON.parse(s.replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,\]}])/g, '$1"$2"'));
const load = (f) => new Function(fs.readFileSync(process.env.MOVE_JS || path.join(__dirname, "..", "code", f), "utf8") + "\nreturn pkMovePlan;")();
const pkMovePlan = load("move.js");
const clone = (o) => JSON.parse(JSON.stringify(o));
const K = {
  lines: "node:search_node_krPmTbfL.data.data",
  records: "node:code_node_oHIIKfiw.data.records",
  locs: "node:search_node_kUwlb6md.data.data",
  batches: "node:search_node_kdhCN7Yu.data.data",
  hus: "node:search_node_ko6ZYIQp.data.data",
};

// the platform substitutes null for a placeholder its recording has no value for (isForceComplete)
const classic = (code, vm) => {
  const values = Object.assign({}, vm);
  for (const m of code.matchAll(/\{\{([a-z]+:[^}]+)\}\}/g)) if (!(m[1] in values)) values[m[1]] = null;
  return runBody(code, values, "iES7iMKA");
};
const ours = (vm) => pkMovePlan({ records: vm[K.records] || [], gdLines: vm[K.lines] || [], locations: vm[K.locs] || [], batches: vm[K.batches] || [], hus: vm[K.hus] || [] });

// every line pkMovePlan rewrites must equal classic's; a line classic changed and we did not must be a tidy-only line
function compare(label, code, vm) {
  const want = classic(code, vm);
  const got = ours(vm);
  const wantById = {};
  for (const l of want.updatedGdLines || []) wantById[String(l.id)] = l;
  const before = {};
  for (const l of vm[K.lines] || []) before[String(l.id)] = l;
  let moved = 0;
  for (const l of got.lines) {
    moved++;
    const w = wantById[l.id];
    truthy(label + ": classic has line " + l.id, !!w);
    if (!w) continue;
    eq(label + ": " + l.id + " temp_qty_data", l.temp_qty_data, w.temp_qty_data);
    eq(label + ": " + l.id + " view_stock", l.view_stock, w.view_stock);
    eq(label + ": " + l.id + " before_temp", l.before_temp, before[l.id].temp_qty_data);
  }
  const ourIds = new Set(got.lines.map((l) => l.id));
  const tidyOnly = Object.values(wantById).filter((w) => !ourIds.has(String(w.id)) && before[String(w.id)] && w.temp_qty_data !== before[String(w.id)].temp_qty_data);
  return { want, got, moved, tidyOnly };
}

const dir = path.join(process.argv[2], "pick");
const fixtures = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
let template = null;
for (const f of fixtures) {
  const fx = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const node = JSON.parse(fx.picking.nodes_data).find((n) => n.node_id === "code_node_iES7iMKA");
  const rq = big(node.request_json_data);
  const recorded = big(node.response_json_data).data;
  const replay = classic(rq.code, rq.variableMap);
  eq(f + ": classic replays to its recording", replay.updatedGdLines.map((l) => [l.id, l.temp_qty_data, l.view_stock]),
    recorded.updatedGdLines.map((l) => [l.id, l.temp_qty_data, l.view_stock]));
  const r = compare(f + " (" + fx.tenant_id + ")", rq.code, rq.variableMap);
  truthy(f + ": at least one moved line", r.moved > 0, r.got);
  eq(f + ": no errors", r.got.errors, []);
  if (r.tidyOnly.length) console.log("     note " + f + ": " + r.tidyOnly.length + " tidy-only line(s) classic rewrote without a move (deliberate: V2 leaves them)");
  if (!template && fx.tenant_id === "073522") template = rq;
}

// ---- synthetic cases on one recorded bay run, classic code as the oracle
const vm0 = template.variableMap;
const code = template.code;
const line0 = vm0[K.lines].find((l) => (vm0[K.records] || []).some((r) => String(r.gd_line_id) === String(l.id)));
const rec0 = vm0[K.records].find((r) => String(r.gd_line_id) === String(line0.id));
const entry0 = JSON.parse(line0.temp_qty_data)[0];
const withLine = (vm, patch) => { vm[K.lines] = vm[K.lines].map((l) => (String(l.id) === String(line0.id) ? Object.assign({}, l, patch) : l)); return vm; };
// a swap is not a bay org: classic's Loading Bay check refuses a target equal to the source
const noBay = (vm) => { vm["node:get_node_Uj1uV9PU.data.data.is_loading_bay"] = 0; return vm; };
const withRec = (vm, patch) => { vm[K.records] = vm[K.records].map((r) => (r === undefined ? r : String(r.gd_line_id) === String(line0.id) ? Object.assign({}, r, patch) : r)); return vm; };

// a partial pick splits the entry: what stays at the source and what moves to the bay
{
  const vm = withLine(clone(vm0), { temp_qty_data: JSON.stringify([Object.assign({}, entry0, { gd_quantity: 5, unrestricted_qty: 5 })]) });
  const r = compare("partial (2 of 5)", code, withRec(vm, { store_out_qty: 2 }));
  eq("partial: two entries", JSON.parse(r.got.lines[0].temp_qty_data).map((e) => [e.location_id, e.gd_quantity]),
    [[rec0.source_bin, 3], [rec0.target_location, 2]]);
}
// a batch swap (same bin): the entry takes the picked batch
{
  const vm = withRec(noBay(clone(vm0)), { target_location: rec0.source_bin, target_batch: "2999999999999999999" });
  const r = compare("batch swap", code, vm);
  eq("batch swap: batch rewritten", JSON.parse(r.got.lines[0].temp_qty_data).map((e) => [e.location_id, e.batch_id]),
    [[rec0.source_bin, "2999999999999999999"]]);
}
// a target equal to the source moves nothing; an empty target moves nothing (both sides must be set)
{
  const r1 = compare("target = source", code, withRec(noBay(clone(vm0)), { target_location: rec0.source_bin }));
  eq("target = source: no line", r1.got.lines.length, 0);
  const r2 = compare("empty target", code, withRec(noBay(clone(vm0)), { target_location: "" }));
  eq("empty target: no line", r2.got.lines.length, 0);
}
// two entries at the target bin after the move are merged (dedupe by bin / batch / HU)
{
  const other = Object.assign({}, entry0, { location_id: rec0.target_location, gd_quantity: 4, unrestricted_qty: 4 });
  const vm = withLine(clone(vm0), { temp_qty_data: JSON.stringify([entry0, other]) });
  const r = compare("dedupe at the bay", code, vm);
  const qty = Number(entry0.gd_quantity), picked = Number(rec0.store_out_qty);
  eq("dedupe: merged at the bay", JSON.parse(r.got.lines[0].temp_qty_data).map((e) => [e.location_id, e.gd_quantity]),
    picked >= qty ? [[rec0.target_location, qty + 4]] : [[rec0.source_bin, qty - picked], [rec0.target_location, picked + 4]]);
}
// an HU entry keeps its HU when it moves
{
  const vm = withLine(clone(vm0), { temp_qty_data: JSON.stringify([Object.assign({}, entry0, { handling_unit_id: "2888888888888888888" })]) });
  const r = compare("HU entry", code, vm);
  eq("HU entry: HU kept", JSON.parse(r.got.lines[0].temp_qty_data)[0].handling_unit_id, "2888888888888888888");
}
// loose stock moving onto a bin that holds an HU entry of the same batch stays a separate entry (dedupe keys on the HU)
{
  const hu = Object.assign({}, entry0, { location_id: rec0.target_location, gd_quantity: 4, unrestricted_qty: 4, handling_unit_id: "2888888888888888888" });
  const vm = withLine(clone(vm0), { temp_qty_data: JSON.stringify([entry0, hu]) });
  const r = compare("loose onto an HU entry", code, vm);
  eq("loose onto an HU entry: two entries", JSON.parse(r.got.lines[0].temp_qty_data).length, 2);
}
// no entry at the source bin: classic silently moves nothing; V2 refuses
{
  const vm = withLine(clone(vm0), { temp_qty_data: JSON.stringify([Object.assign({}, entry0, { location_id: "2777777777777777777" })]) });
  const want = classic(code, vm);
  const got = ours(vm);
  eq("missing entry: classic leaves the allocation", want.updatedGdLines.find((l) => String(l.id) === String(line0.id)).temp_qty_data, vm[K.lines].find((l) => String(l.id) === String(line0.id)).temp_qty_data);
  eq("missing entry: V2 refuses", got.errors.map((e) => [e.code, e.gd_line_id]), [["PK_MOVE_NO_ALLOCATION", String(line0.id)]]);
  eq("missing entry: no line", got.lines.length, 0);
}
// a line stored Completed is skipped, as classic skips it
{
  const vm = withLine(clone(vm0), { picking_status: "Completed" });
  const r = compare("stored Completed", code, vm);
  eq("stored Completed: no line", r.got.lines.length, 0);
}
// a picked quantity of 0 moves nothing
{
  const r = compare("zero picked", code, withRec(clone(vm0), { store_out_qty: 0 }));
  eq("zero picked: no line", r.got.lines.length, 0);
}
// output carries the GD of each moved line
{
  const got = ours(clone(vm0));
  eq("gds: the moved line's GD", got.gds.map((g) => [g.gd_id, g.line_ids]), [[String(line0.goods_delivery_id), [String(line0.id)]]]);
}
done();
