// Stage 1b parity: one Full Picking confirmation through the DEPLOYED PICKING nodes (code_node_Z5JH4g2u -> code_node_iES7iMKA ->
// code_node_MNRecompute, dev v150 = prod v79) and through PREPARE plan + COMMIT P3 (Full Picking) -> the same line statuses,
// the same GD line picked_qty / picked bins / picked_view_stock / picking_status, the same refusals.
const fs = require("fs");
const path = require("path");
const { run, runBody, eq, done } = require("./harness");

const OLD = (id) => fs.readFileSync(path.join(__dirname, "src1b", id + ".js"), "utf8");
const S = (v) => (v === undefined || v === null ? null : String(v));
const n8 = (v) => (v === undefined || v === null ? null : Number(v).toFixed(8));
const names = { B1: "Zone A-01", B2: "Zone B-07", BT1: "LOT-1" };
const locations = [{ id: "B1", bin_location_combine: "Zone A-01" }, { id: "B2", bin_name: "Zone B-07" }];
const batches = [{ id: "BT1", batch_number: "LOT-1" }];

function scenario(over) {
  const o = Object.assign({ sibling: [{ gd_line_id: "G3", store_out_qty: 2, source_bin: "B1" }] }, over || {});
  const row = (id, gl, qty, bin, batch, extra) => Object.assign({ id: id, item_code: "IT", item_name: "Item " + gl, item_uom: "PCS", qty_to_pick: qty, pending_process_qty: qty, line_status: "Open",
    gd_id: gl === "G7" ? "D2" : "D1", gd_no: "GD/1", gd_line_id: gl, so_id: "S1", so_no: "SO/1", so_line_id: "SL" + gl, source_bin: bin, batch_no: batch || null, row_type: "item",
    packing_conversion: 1, weight_conversion: 0, remark: "" }, extra || {});
  const tree = [
    row("81", "G1", 5, "B1"), row("82", "G2", 2, "B2", "BT1"), row("83", "G3", 4, "B1"), row("84", "G4", 3, "B1"),
    Object.assign(row("85", "GB", 1, null), { item_code: null, item_bundle_id: "BUN", item_name: "Gift Set", children: [
      row("851", "G5", 2, "B1", null, { item_bundle_id: "BUN", parent_id: "85", item_name: "Mug" }), row("852", "G6", 2, "B1", null, { item_bundle_id: "BUN", parent_id: "85", item_name: "Spoon" })] }),
    row("86", "G7", 2, "B1"), row("87", "G7", 2, "B2"),
  ];
  const gdQty = { G1: 5, G2: 2, G3: 6, G4: 3, G5: 2, G6: 2, G7: 4 };
  const gdBin = { G2: ["B2", "BT1"] };
  const siblingSum = {};
  for (const r of o.sibling) siblingSum[r.gd_line_id] = (siblingSum[r.gd_line_id] || 0) + r.store_out_qty;
  const gdLines = Object.keys(gdQty).map((gl) => {
    const [bin, batch] = gdBin[gl] || ["B1", null];
    const pickedBefore = siblingSum[gl] ? [{ material_id: "IT", location_id: "B1", batch_id: null, handling_unit_id: null, gd_quantity: siblingSum[gl], plant_id: "P1", organization_id: "O1" }] : null;
    return { id: gl, goods_delivery_id: gl === "G7" ? "D2" : "D1", material_id: "IT", material_name: "Item " + gl, gd_qty: gdQty[gl], plant_id: "P1", organization_id: "O1",
      temp_qty_data: JSON.stringify([{ material_id: "IT", location_id: bin, batch_id: batch, gd_quantity: gdQty[gl] }]), view_stock: "Total: " + gdQty[gl] + " PCS\n\nDETAILS:\n1. x",
      picking_status: siblingSum[gl] ? "In Progress" : "Created", picked_qty: siblingSum[gl] || 0, picked_temp_qty_data: pickedBefore ? JSON.stringify(pickedBefore) : null, prev_temp_qty_data: null, picked_view_stock: null };
  });
  return { tree: tree, gdLines: gdLines, sibling: o.sibling };
}

function oldPath(sc, picks) {
  // the deployed path: records -> Z5JH4g2u -> iES7iMKA -> MNRecompute (the records come from PREPARE: equal to PICKING's, stage 1a parity)
  const records = picks.records.map((r) => Object.assign({}, r, { picking_item_id: r.job_line_key.split("|")[1] }));
  const stored = { id: "9001", table_picking_items: sc.tree, table_picking_records: [] };
  const allData = { id: "9001", table_picking_items: sc.tree, table_picking_records: [], split_data: {} };
  const z5 = runBody(OLD("code_node_Z5JH4g2u"), { "node:get_node_jEllcWiJ.data.data": stored, "workflowparams:allData": allData, "node:code_node_oHIIKfiw.data.records": records,
    "workflowparams:isForceComplete": 0, "node:get_node_Uj1uV9PU.data.data.allow_full_picking": 1 }, "Z5");
  const touched = new Set(records.map((r) => r.gd_line_id));
  const gdLines = sc.gdLines.filter((l) => touched.has(l.id));
  const ies = runBody(OLD("code_node_iES7iMKA"), { "node:search_node_krPmTbfL.data.data": gdLines, "node:code_node_oHIIKfiw.data.records": records, "node:code_node_Z5JH4g2u.data.updatedItems": z5.updatedItems,
    "node:search_node_kUwlb6md.data.data": locations, "node:search_node_kdhCN7Yu.data.data": batches, "node:search_node_ko6ZYIQp.data.data": [], "workflowparams:allData": allData, "workflowparams:isForceComplete": 0,
    "node:get_node_Uj1uV9PU.data.data.allow_full_picking": 1, "node:get_node_Uj1uV9PU.data.data.is_loading_bay": 0, "node:get_node_Uj1uV9PU.data.data.auto_completed_gd": 0 }, "iES");
  if (ies.code !== "200") return { refused: ies.message };
  const sib = sc.sibling.map((r) => ({ sibling_id: "9000", gd_line_id: r.gd_line_id, store_out_qty: String(r.store_out_qty), source_bin: r.source_bin, target_location: null, batch_no: null, target_batch: null, handling_unit_id: null }));
  const mn = runBody(OLD("code_node_MNRecompute"), { "node:search_node_krPmTbfL.data.data": gdLines, "node:sql_node_SibRecs.data": sib, "node:code_node_Z5JH4g2u.data.combinedRecords": z5.combinedRecords,
    "workflowparams:allData": allData, "workflowparams:isForceComplete": 0, "node:search_node_kUwlb6md.data.data": locations, "node:search_node_kdhCN7Yu.data.data": batches, "node:search_node_ko6ZYIQp.data.data": [],
    "node:code_node_iES7iMKA.data.updatedGdLines": ies.updatedGdLines }, "MN");
  const finalLines = {};
  for (const l of ies.updatedGdLines) finalLines[l.id] = l;
  for (const l of mn.updatedLines) finalLines[l.id] = Object.assign({}, finalLines[l.id], l);
  const rows = {};
  for (const it of z5.updatedItems.flatMap((r) => [r].concat(r.children || []))) rows[it.id] = [it.line_status, Number(it.pending_process_qty)];
  return { rows: rows, toStatus: z5.toStatus, lines: finalLines };
}

function newPath(sc, lines) {
  const flat = sc.tree.flatMap((r) => [r].concat(r.children || []));
  const sqlLine = (r) => ({ id: r.id, parent_id: S(r.parent_id), item_code: S(r.item_code), item_name: r.item_name, item_desc: "", more_desc: "", item_uom: "PCS", qty_to_pick: n8(r.qty_to_pick), pending_process_qty: n8(r.pending_process_qty),
    line_status: r.line_status, gd_id: r.gd_id, gd_no: r.gd_no, gd_line_id: r.gd_line_id, so_id: r.so_id, so_no: r.so_no, so_line_id: r.so_line_id, source_bin: S(r.source_bin), target_location: null,
    batch_no: S(r.batch_no), target_batch: null, handling_unit_id: null, item_bundle_id: S(r.item_bundle_id), row_type: r.row_type, remark: "", remark_2: null, remark_3: null, attachment: null });
  const sibSum = {};
  for (const r of sc.sibling) sibSum[r.gd_line_id] = (sibSum[r.gd_line_id] || 0) + r.store_out_qty;
  const res = run("prepare/plan.js", {
    "node:code_node_PPentry.data": { route: "GO", jobId: "77", pickingId: "9001", organizationId: "O1", rowVersion: 1, dbNow: "2026-10-13 10:00:00", confirmedAt: "2026-10-13 18:00:00.000Z", request: { operation: "CONFIRM", confirmed_by: "p", lines: lines } },
    "node:sql_node_PPhdr.data": [{ id: "9001", to_id: "PI-1", to_status: "Created", is_deleted: "0", organization_id: "O1", plant_id: "P1", gd_no_json: "[\"D1\",\"D2\"]", delivery_no: "", so_no: "SO/1",
      picking_after: "Goods Delivery", allow_full_picking: "1", auto_completed_gd: "0", setup_loading_bay: null, packing_required: "1", auto_trigger_pkg: "1", packing_mode: "Detail" }],
    "node:sql_node_PPlines.data": flat.map(sqlLine),
    "node:sql_node_PPgd.data": sc.gdLines.map((l) => ({ id: l.id, goods_delivery_id: l.goods_delivery_id, picking_status: l.picking_status, gd_status: "Created", gd_qty: n8(l.gd_qty), material_name: l.material_name })),
    "node:sql_node_PPuom.data": [],
    "node:sql_node_PPpicked.data": Object.keys(sibSum).map((k) => ({ gd_line_id: k, picked_qty: n8(sibSum[k]) })),
  });
  if (res.route !== "OK") return { refused: res.result_message, code: res.result_code };
  const p = JSON.parse(res.readyRows[0].prepared_payload);
  // P1 stores this job's records after the sibling's (younger ids); P3 reads the touched lines + every record
  const touched = new Set(p.gd_lines.map((l) => l.id));
  let rid = 1000;
  const recRows = sc.sibling.map((r) => ({ kind: "R", id: r.gd_line_id, rid: String(++rid), qty: n8(r.store_out_qty), loc: r.source_bin, batch: null, hu: null, loc_name: names[r.source_bin], batch_name: null, hu_name: null }))
    .concat(p.records.map((r) => ({ kind: "R", id: r.gd_line_id, rid: String(++rid), qty: n8(r.store_out_qty), loc: r.target_location || r.source_bin, batch: r.target_batch || r.batch_no || null, hu: null,
      loc_name: names[r.target_location || r.source_bin], batch_name: names[r.target_batch || r.batch_no] || null, hu_name: null })));
  const lineRows = sc.gdLines.filter((l) => touched.has(l.id)).map((l) => ({ kind: "L", id: l.id, gd_qty: n8(l.gd_qty), material_id: l.material_id, plant_id: l.plant_id, organization_id: l.organization_id,
    picking_status: l.picking_status, picked_qty: n8(l.picked_qty), temp_qty_data: l.temp_qty_data, prev_temp_qty_data: l.prev_temp_qty_data, picked_temp_qty_data: l.picked_temp_qty_data,
    picked_view_stock: l.picked_view_stock, view_stock: l.view_stock }));
  const plan = run("commit/p3fp_plan.js", { "node:get_cache_PCp3fpSt.data": [0, 0, 0, 0], "node:sql_node_PCp3fpFacts.data": lineRows.concat(recRows) });
  const out = {};
  for (const sl of plan.slices) for (const r of sl.rows) out[r.id] = r;
  const rows = {};
  for (const id of Object.keys(p.row_patch)) rows[id] = [p.row_patch[id].line_status, p.row_patch[id].pending_process_qty];
  return { rows: rows, lines: out, payload: p };
}

const qtyMap = (json) => {
  const out = {};
  for (const e of JSON.parse(json || "[]")) out[(e.location_id || "-") + "|" + (e.batch_id || "-") + "|" + (e.handling_unit_id || "-")] = Math.round(e.gd_quantity * 1000) / 1000;
  return out;
};
const lineView = (l) => (l ? [l.picking_status, Math.round(Number(l.picked_qty) * 1000) / 1000, qtyMap(l.picked_temp_qty_data), l.picked_view_stock] : null);

// ---------- 1. a short pick, full picks, a remainder of a sibling's line, a bundle in full, a GD line on two rows of which one is picked
const picks = [{ row_id: "81", qty: 3 }, { row_id: "82", qty: 2 }, { row_id: "83", qty: 4 }, { row_id: "851", qty: 2 }, { row_id: "852", qty: 2 }, { row_id: "86", qty: 2 }];
let sc = scenario();
const nw = newPath(sc, picks);
const old = oldPath(sc, nw.payload);
const touchedRows = Object.keys(nw.rows);
eq("rows: status + pending of every picked row = PICKING's", touchedRows.map((id) => nw.rows[id]), touchedRows.map((id) => old.rows[id]));
eq("rows: short pick closes the line (81 Completed, pending 0); 87 untouched", [nw.rows["81"], nw.rows["87"], old.rows["87"]], [["Completed", 0], undefined, ["Open", 2]]);
for (const gl of ["G1", "G2", "G3", "G5", "G6", "G7"]) eq("GD line " + gl + ": status / picked_qty / picked bins / picked_view_stock = PICKING's", lineView(nw.lines[gl]), lineView(old.lines[gl]));
eq("statuses: G1 In Progress (3/5), G3 Completed (2 sibling + 4), G7 In Progress (2/4 on two rows)", ["G1", "G3", "G7"].map((g) => nw.lines[g].picking_status), ["In Progress", "Completed", "In Progress"]);
eq("PREPARE's provisional GD line status = the recount", nw.payload.gd_lines.map((l) => [l.id, l.picking_status]), nw.payload.gd_lines.map((l) => [l.id, nw.lines[l.id].picking_status]));

// ---------- 2. over-pick: the sibling already holds 3 of G3's 6, this pick adds 4
sc = scenario({ sibling: [{ gd_line_id: "G3", store_out_qty: 3, source_bin: "B1" }] });
const nw2 = newPath(sc, [{ row_id: "83", qty: 4 }]);
const prep = newPath(scenario(), [{ row_id: "83", qty: 4 }]).payload;
const old2 = oldPath(sc, Object.assign({}, prep, { records: prep.records }));
eq("over-pick refused with PICKING's message", [nw2.code, nw2.refused], ["PK_OVER_PICK", old2.refused]);

// ---------- 3. bundle: one item short under Full Picking
sc = scenario();
const nw3 = newPath(sc, [{ row_id: "851", qty: 2 }, { row_id: "852", qty: 1 }]);
// the old node judges the bundle from the session's records: the same two picks (852 short), taken from case 1's records
const rec3 = nw.payload.records.filter((r) => ["851", "852"].includes(r.job_line_key.split("|")[1]))
  .map((r) => (r.job_line_key.split("|")[1] === "852" ? Object.assign({}, r, { store_out_qty: 1, picked_qty_alt: 1 }) : r));
const old3 = oldPath(sc, { records: rec3 });
eq("bundle short refused with PICKING's message", [nw3.code, nw3.refused], ["PK_BUNDLE_SHORT", old3.refused]);
const nw4 = newPath(scenario(), [{ row_id: "851", qty: 1 }, { row_id: "852", qty: 1 }]);
eq("bundle: part of every item is refused under Full Picking", nw4.code, "PK_BUNDLE_SHORT");

done();
