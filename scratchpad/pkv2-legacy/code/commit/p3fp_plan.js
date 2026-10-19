// PICKING_BULK_COMMIT - P3 plan (Full Picking): each touched GD line recounted from the records of EVERY Picking, as
// code_node_MNRecompute does -> picked_qty, picked_temp_qty_data, picked_view_stock, picking_status, plus prev_temp_qty_data =
// the allocation as stored now. Only lines whose stored values differ are written, in slices of <= 250. A pass with nothing
// to write settles the step: the lines then match every record read in the same statement, and a sibling Picking that adds
// records later recounts after its own write.
const commitP3fpPlan = function commitP3fpPlan(stateRaw, facts) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
  const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
  const r3 = (v) => Math.round((parseFloat(v) || 0) * 1000) / 1000;
  let st = stateRaw;
  if (typeof st === "string") {
    try {
      st = JSON.parse(st);
    } catch (e) {
      st = null;
    }
  }
  st = Array.isArray(st) && st.length >= 4 ? st.map((x) => Number(x) || 0) : [0, 0, 0, 0];

  const lines = {};
  const recs = {};
  const locName = {};
  const batchName = {};
  const huName = {};
  for (const f of list(facts)) {
    if (f.kind === "L") lines[s(f.id)] = f;
    else if (f.kind === "R") {
      (recs[s(f.id)] = recs[s(f.id)] || []).push(f);
      if (s(f.loc) && s(f.loc_name)) locName[s(f.loc)] = s(f.loc_name);
      if (s(f.batch) && s(f.batch_name)) batchName[s(f.batch)] = s(f.batch_name);
      if (s(f.hu) && s(f.hu_name)) huName[s(f.hu)] = s(f.hu_name);
    }
  }
  const buildViewStock = (entries, uom) => {
    const active = entries.filter((e) => (e.gd_quantity || 0) > 0);
    if (active.length === 0) return "Total: 0 " + uom + "\n\nDETAILS:\nNo stock allocated";
    const loose = active.filter((e) => !e.handling_unit_id);
    const huRows = active.filter((e) => e.handling_unit_id);
    const total = active.reduce((sum, e) => sum + (e.gd_quantity || 0), 0);
    const fmtBatch = (e) => (e.batch_id ? "\n[Batch: " + (batchName[e.batch_id] || e.batch_id) + "]" : "");
    const looseSection = loose.map((e, i) => (i + 1) + ". " + (locName[e.location_id] || e.location_id) + ": " + e.gd_quantity + " " + uom + fmtBatch(e)).join("\n");
    const huSection = huRows.map((e, i) => (i + 1) + ". " + (huName[e.handling_unit_id] || e.handling_unit_id) + ": " + e.gd_quantity + " " + uom + fmtBatch(e)).join("\n");
    let out = "Total: " + total + " " + uom + "\n\n";
    if (loose.length > 0 && huRows.length > 0) out += "LOOSE STOCK:\n" + looseSection + "\n\nHANDLING UNIT:\n" + huSection;
    else if (huRows.length > 0) out += "HANDLING UNIT:\n" + huSection;
    else out += "DETAILS:\n" + looseSection;
    return out;
  };
  const mergeKey = (locId, batchId, huId) => (locId || "no-location") + "_" + (batchId || "none") + "_" + (huId || "no_hu");
  const qtyByKey = (entries) => {
    const out = {};
    for (const e of Array.isArray(entries) ? entries : []) {
      const q = Math.round((parseFloat(e && e.gd_quantity) || 0) * 1000);
      if (q <= 0) continue;
      const k = mergeKey(e.location_id, e.batch_id, e.handling_unit_id);
      out[k] = (out[k] || 0) + q;
    }
    return out;
  };
  const sameEntries = (stored, entries) => {
    let a;
    try {
      a = qtyByKey(typeof stored === "string" && stored ? JSON.parse(stored) : stored);
    } catch (e) {
      return false;
    }
    const b = qtyByKey(entries);
    return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);
  };
  // snowflake ids as text: oldest record first, so the bins list in the same order on every pass
  const byId = (x, y) => (s(x.rid).length - s(y.rid).length) || (s(x.rid) < s(y.rid) ? -1 : s(x.rid) > s(y.rid) ? 1 : 0);

  const rows = [];
  let recounted = 0;
  let over = 0;
  for (const id of Object.keys(lines).sort()) {
    const line = lines[id];
    const lineRecs = (recs[id] || []).slice().sort(byId);
    // a line no Picking holds a record for is left as it is (code_node_MNRecompute)
    if (!lineRecs.length) continue;
    recounted++;
    const merged = new Map();
    for (const rec of lineRecs) {
      const qty = parseFloat(rec.qty) || 0;
      if (qty <= 0) continue;
      const locId = s(rec.loc) || null;
      const batchId = s(rec.batch) || null;
      const huId = s(rec.hu) || null;
      const k = mergeKey(locId, batchId, huId);
      if (merged.has(k)) merged.get(k).gd_quantity += qty;
      else merged.set(k, { material_id: s(line.material_id), location_id: locId, batch_id: batchId, handling_unit_id: huId, gd_quantity: qty, plant_id: s(line.plant_id), organization_id: s(line.organization_id) });
    }
    const entries = Array.from(merged.values()).map((e) => Object.assign(e, { gd_quantity: q8(e.gd_quantity) }));
    const total = r3(entries.reduce((sum, e) => sum + e.gd_quantity, 0));
    const planQty = parseFloat(line.gd_qty) || 0;
    if (planQty > 0 && r3(total - planQty) > 0) over++;
    const status = total >= planQty && planQty > 0 ? "Completed" : total > 0 ? "In Progress" : "Created";
    let uom = "PCS";
    const m = s(line.view_stock).match(/Total:\s*[\d.]+\s+(\w+)/);
    if (m && m[1]) uom = m[1];
    const view = buildViewStock(entries, uom);
    const text = (v) => (v === null || v === undefined ? "" : String(v));
    const prev = text(line.temp_qty_data) || "[]";
    const same = s(line.picking_status) === status && r3(line.picked_qty) === total && sameEntries(line.picked_temp_qty_data, entries)
      && text(line.picked_view_stock) === view && text(line.prev_temp_qty_data) === prev;
    if (same) continue;
    rows.push({ id: id, picking_status: status, prev_temp_qty_data: prev, picked_qty: total, picked_temp_qty_data: JSON.stringify(entries), picked_view_stock: view });
  }
  const slices = [];
  for (let i = 0; i < rows.length; i += 250) slices.push({ rows: rows.slice(i, i + 250) });
  const state = [rows.length ? 0 : 1, st[1] + 1, st[2] + rows.length, over];
  return {
    slices: slices, hasRows: rows.length ? "YES" : "NO", count: rows.length, lines: recounted, state: state,
    result_message: "pass " + state[1] + ": " + recounted + " GD line(s) recounted, " + rows.length + " to write" + (over ? "; " + over + " above the GD quantity" : ""),
  };
};
const res = commitP3fpPlan([{{node:get_cache_PCp3fpSt.data}}][0], [{{node:sql_node_PCp3fpFacts.data}}][0]);
console.log("commit P3 plan (Full Picking)", JSON.stringify({ count: res.count, lines: res.lines, slices: res.slices.length, state: res.state }));
return res;
