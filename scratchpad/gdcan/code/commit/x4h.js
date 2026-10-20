// GD_CANCEL_COMMIT - X4H UNPACK: the boxes the cancelled open Packings generated are unloaded as the Packing form's Unpack
// (PackingOnUnpackHU) does: one REPACKING_PROCESS Unload (isPacking 1: HU records only) per box from the box's own stored items
// (bladexfunctions-79, live Packing v205 / REPACKING_PROCESS v17 / HANDLING_UNIT v38). A box's own emptiness is the marker: an
// empty box is not unloaded again (a second Unload answers 400 and writes nothing). Then the form's own writes, set-based: the
// box and the 'locked' boxes leave the Packing (packing_id ''), nested boxes leave the box (parent_hu_id ''), their source rows
// Unpacked, the box row emptied and Unpacked (the Cancelled Packing keeps it as the record of the unpack).
const HU_COLS = ["packing_id", "parent_hu_id"];
const BOX_ROW_COLS = ["temp_data", "item_count", "total_quantity", "hu_status"];
const BOX_ROW_AFTER = { temp_data: "[]", item_count: 0, total_quantity: 0, hu_status: "Unpacked" };
const huFacts = function huFacts(rows) {
  const items = {};
  const g = { HU: {}, U: {}, S: {} };
  for (const r of list(rows)) {
    const o = parseJ(r.j);
    if (!o) continue;
    if (s(r.k) === "HI") (items[s(o.handling_unit_id)] = items[s(o.handling_unit_id)] || []).push(o);
    else if (g[s(r.k)]) g[s(r.k)][s(o.id)] = o;
  }
  return { items: items, hus: g.HU, boxRows: g.U, sources: g.S };
};
const huItemKey = (i) => [s(i.material_id), s(i.balance_id), s(i.batch_id), q8(i.quantity).toFixed(8)].join("|");
const cancelX4HIds = function cancelX4HIds(entry, partRows) {
  const hu = joinChunks(partRows, entry.partPrefix + "HU|");
  const ids = (xs) => Array.from(new Set(xs.map(s).filter(digits)));
  const boxes = hu ? hu.boxes || [] : [];
  const j = (xs) => JSON.stringify(xs.length ? xs : ["0"]);
  return {
    ok: hu ? "YES" : "NO",
    boxIdsJson: j(ids(boxes.map((b) => b.hu_id))),
    huIdsJson: j(ids(boxes.map((b) => b.hu_id).concat(...boxes.map((b) => b.nested || []), (hu ? hu.released || [] : []).map((r) => r.id)))),
    rowIdsJson: j(ids(boxes.map((b) => b.row_id))),
    sourceIdsJson: j(ids([].concat(...boxes.map((b) => b.sources || [])))),
  };
};
// before the loop: the boxes still holding items are unloaded; one holding something else than PREPARE read = review
const cancelX4HPlan = function cancelX4HPlan(entry, partRows, nowRows) {
  const base = { route: "GO", unload: [], unloadCount: 0, jobRows: [], needJobUpd: "NO", result_code: "", result_message: "" };
  const hu = joinChunks(partRows, entry.partPrefix + "HU|");
  if (!hu) return Object.assign(base, stepEnd(entry, "X4H_UNPACK", "the box part of the prepared payload is missing", true));
  const f = huFacts(nowRows);
  const unload = [];
  const changed = [];
  for (const b of hu.boxes || []) {
    const now = f.items[s(b.hu_id)] || [];
    if (!now.length) continue;
    const was = ((b.request || {}).items || []).map(huItemKey).sort().join(",");
    if (now.map(huItemKey).sort().join(",") !== was) {
      changed.push(s(b.handling_no) || s(b.hu_id));
      continue;
    }
    unload.push({ hu_id: s(b.hu_id), handling_no: s(b.handling_no), request: b.request });
  }
  if (changed.length) return Object.assign(base, stepEnd(entry, "X4H_UNPACK", "box(es) " + changed.slice(0, 3).join(", ") + " hold something else than when the cancel was prepared", true));
  return Object.assign(base, { unload: unload, unloadCount: unload.length, result_message: unload.length + " box(es) to unload" });
};
// one loop item -> REPACKING_PROCESS's request
const cancelX4HCall = function cancelX4HCall(item) {
  const r = (item || {}).request || {};
  return { plant_id: s(r.plant_id), organization_id: s(r.organization_id), process_type: "Unload", trx_no: s(r.trx_no), parent_trx_no: s(r.parent_trx_no),
    items: Array.isArray(r.items) ? r.items : [], source_hu: r.source_hu || {}, target_hu: null, target_storage_location_id: s(r.target_storage_location_id),
    target_location_id: s(r.target_location_id), remark: s(r.remark), transaction_type: "Packing", isPacking: 1 };
};
// after the loop: every box empty (else retry: a failed Unload wrote nothing), then the form's writes on the rows read now
const cancelX4HPost = function cancelX4HPost(entry, partRows, nowRows) {
  const base = { route: "GO", huRows: [], needHu: "NO", boxRows: [], needBoxRows: "NO", sourceRows: [], needSources: "NO", jobRows: [], needJobUpd: "NO", result_code: "", result_message: "" };
  const hu = joinChunks(partRows, entry.partPrefix + "HU|") || {};
  const f = huFacts(nowRows);
  const full = (hu.boxes || []).filter((b) => (f.items[s(b.hu_id)] || []).length).map((b) => s(b.handling_no) || s(b.hu_id));
  if (full.length) return Object.assign(base, stepEnd(entry, "X4H_UNPACK", "box(es) " + full.slice(0, 3).join(", ") + " still hold items after the Unload", false));
  const want = {};
  const conflicts = [];
  const set = (id, col, from, to) => {
    const cur = f.hus[id];
    if (!cur || String(cur.is_deleted) !== "0") return conflicts.push("HU " + id + " (gone)");
    if (s(cur[col]) === s(to)) return;
    if (s(cur[col]) !== s(from)) return conflicts.push("HU " + id + " " + col);
    want[id] = want[id] || { id: id, packing_id: cur.packing_id === undefined ? null : cur.packing_id, parent_hu_id: cur.parent_hu_id === undefined ? null : cur.parent_hu_id };
    want[id][col] = to;
  };
  for (const b of hu.boxes || []) {
    set(s(b.hu_id), "packing_id", b.packing_id, "");
    for (const n of b.nested || []) set(s(n), "parent_hu_id", b.hu_id, "");
  }
  for (const r of hu.released || []) set(s(r.id), "packing_id", r.before.packing_id, "");
  if (conflicts.length) return Object.assign(base, stepEnd(entry, "X4H_UNPACK", conflicts.length + " handling unit(s) changed by someone else meanwhile (e.g. " + conflicts.slice(0, 3).join(", ") + ")", true));
  const boxRows = [];
  for (const b of hu.boxes || []) {
    const cur = f.boxRows[s(b.row_id)];
    if (!cur || String(cur.is_deleted) !== "0") continue;
    if (!BOX_ROW_COLS.every((c) => sameVal(cur[c], BOX_ROW_AFTER[c]))) boxRows.push(Object.assign({ id: s(b.row_id) }, BOX_ROW_AFTER));
  }
  const sourceRows = [];
  for (const id of [].concat(...(hu.boxes || []).map((b) => b.sources || []))) {
    const cur = f.sources[s(id)];
    if (cur && String(cur.is_deleted) === "0" && s(cur.hu_status) !== "Unpacked") sourceRows.push({ id: s(id), hu_status: "Unpacked" });
  }
  const huRows = Object.values(want);
  return Object.assign(base, { huRows: huRows, needHu: huRows.length ? "YES" : "NO", boxRows: boxRows, needBoxRows: boxRows.length ? "YES" : "NO",
    sourceRows: sourceRows, needSources: sourceRows.length ? "YES" : "NO",
    result_message: (hu.boxes || []).length + " box(es) empty; " + huRows.length + " handling unit(s), " + boxRows.length + " box row(s), " + sourceRows.length + " source row(s) to write" });
};
const cancelX4HCheck = function cancelX4HCheck(entry, partRows, nowRows) {
  const hu = joinChunks(partRows, entry.partPrefix + "HU|") || {};
  const f = huFacts(nowRows);
  const off = [];
  for (const b of hu.boxes || []) {
    if ((f.items[s(b.hu_id)] || []).length) off.push(s(b.hu_id) + " items");
    if (f.hus[s(b.hu_id)] && s(f.hus[s(b.hu_id)].packing_id) !== "") off.push(s(b.hu_id) + " packing_id");
    for (const n of b.nested || []) if (f.hus[s(n)] && s(f.hus[s(n)].parent_hu_id) !== "") off.push(s(n) + " parent_hu_id");
    const row = f.boxRows[s(b.row_id)];
    if (row && String(row.is_deleted) === "0" && !BOX_ROW_COLS.every((c) => sameVal(row[c], BOX_ROW_AFTER[c]))) off.push("row " + s(b.row_id));
  }
  for (const r of hu.released || []) if (f.hus[s(r.id)] && s(f.hus[s(r.id)].packing_id) !== "") off.push(s(r.id) + " packing_id");
  if (off.length) return stepEnd(entry, "X4H_UNPACK", off.length + " value(s) do not read back (e.g. " + off.slice(0, 3).join(", ") + ")", false);
  return stepOk(entry, "X4H_UNPACK", (hu.boxes || []).length + " box(es) unpacked, " + (hu.released || []).length + " released", "boxes unpacked");
};
