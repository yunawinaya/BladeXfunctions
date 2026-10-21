// Picking 1d - fcPlan: a Force Complete's per-delivery GD edits, from the database (spec ~/.claude/plans/delightful-imagining-naur.md).
// Inlined into PICKING_BULK_PREPARE code_node_PPfc after view_stock.js (the patcher drops the require / exports lines).
// /*M:...*/ markers are mutation points for scratchpad/pk1d/test/test_fc_plan.js.
const { buildViewStock, mergeByKey, uomFromViewStock, normBatch } = require(__dirname + "/view_stock.js");
const { fcLineFingerprint, fcRowsFingerprint } = require(__dirname + "/fc_fp.js");

const EPS = 1e-6;
const q8 = (v) => Number(v).toFixed(8);
const r8 = (v) => Math.round(Number(v) * 1e8) / 1e8;
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const num = (v) => { const x = Number(v); return isFinite(x) ? x : 0; };
const arr = (v) => {
  if (Array.isArray(v)) return v;
  if (!s(v)) return [];
  try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch (e) { return []; }
};
const idCmp = (a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0);
const keyOf = (e) => s(e.location_id) + "_" + (normBatch(e.batch_id) || "none") + "_" + (s(e.handling_unit_id) || "no_hu");
const canon = (entries) => mergeByKey(entries).filter((e) => num(e.gd_quantity) > EPS).map((e) => keyOf(e) + ":" + r8(num(e.gd_quantity))).sort().join("|");
// Shared with DRIVE's F0 and COMMIT's P0F checks: the Picking's rows as they stood at PREPARE
const rowsFingerprint = fcRowsFingerprint;
const lineFingerprint = fcLineFingerprint;

// temp_hu_data (the HU carrier): only the picked HUs, each entry scaled to what was picked from that HU
const huData = (l, recs) => {
  const stored = arr(l.temp_hu_data);
  if (!stored.length) return null;
  const picked = {}, held = {};
  for (const r of recs) if (s(r.handling_unit_id)) picked[s(r.handling_unit_id)] = r8((picked[s(r.handling_unit_id)] || 0) + num(r.store_out_qty));
  for (const e of stored) held[s(e.handling_unit_id)] = (held[s(e.handling_unit_id)] || 0) + num(e.deliver_quantity);
  return JSON.stringify(stored.filter((e) => (picked[s(e.handling_unit_id)] || 0) > EPS).map((e) => {
    const h = s(e.handling_unit_id);
    return Object.assign({}, e, { deliver_quantity: held[h] > EPS ? r8(num(e.deliver_quantity) * picked[h] / held[h]) : picked[h] });
  }));
};

function fcPlan(input) {
  const P0 = input.picking || {};
  const toNo = s(P0.to_id);
  const fail = (code, message) => ({ ok: false, code: code, message: message });
  if (s(P0.to_status) !== "In Progress") return fail("PK_FC_NOT_IN_PROGRESS", toNo + " is not In Progress (" + (s(P0.to_status) || "no status") + ").");
  const allRecords = input.records || [];
  const ownRecords = allRecords.filter((r) => s(r.transfer_order_id) === s(P0.id));
  if (!ownRecords.some((r) => num(r.store_out_qty) > EPS)) return fail("PK_FC_NO_RECORDS", toNo + " has nothing picked: cancel it instead.");

  const rows = (input.rows || []).filter((r) => s(r.gd_line_id));
  const gds = {}, lines = {}, kidsOf = {}, rowById = {};
  for (const g of input.gds || []) gds[s(g.id)] = g;
  for (const l of input.gdLines || []) {
    lines[s(l.id)] = l;
    if (s(l.parent_id)) (kidsOf[s(l.parent_id)] = kidsOf[s(l.parent_id)] || []).push(l);
  }
  for (const r of rows) rowById[s(r.id)] = r;
  const names = input.names || {};
  const lineName = (l) => s(l.material_name) || s(l.material_id) || s(l.id);
  const gdNo = (l) => s((gds[s(l.goods_delivery_id)] || {}).delivery_no);

  const live = rows.filter((r) => s(r.line_status) !== "Cancelled");
  const onPick = {};
  for (const r of live) onPick[s(r.gd_line_id)] = true;
  for (const o of input.otherOpen || []) {
    if (s(o.transfer_order_id) !== s(P0.id) && onPick[s(o.gd_line_id)]) {
      const l = lines[s(o.gd_line_id)] || {};
      return fail("PK_FC_SHARED_LINE", gdNo(l) + " " + lineName(l) + " is also on Picking " + s(o.to_id) + ". Complete or cancel that Picking first.");
    }
  }
  for (const r of live) {
    const l = lines[s(r.gd_line_id)];
    if (l && s(r.item_uom) && s(l.gd_order_uom_id) && s(r.item_uom) !== s(l.gd_order_uom_id)) {
      return fail("PK_FC_UOM", gdNo(l) + " " + lineName(l) + ": the Picking row's unit differs from the delivery line's unit.");
    }
  }

  // What each GD line has had picked: every Picking that is not Cancelled, minus V2 records of this Picking's Cancelled rows
  const recsOf = {};
  for (const r of allRecords) {
    if (!(/*M:sibling*/ s(r.to_status) !== "Cancelled")) continue;
    const rowId = s(r.job_line_key).split("|")[1];
    if (s(r.transfer_order_id) === s(P0.id) && rowId && rowById[rowId] && s(rowById[rowId].line_status) === "Cancelled") continue;
    if (num(r.store_out_qty) <= EPS) continue;
    (recsOf[s(r.gd_line_id)] = recsOf[s(r.gd_line_id)] || []).push(r);
  }
  const pickedOf = (l) => r8((recsOf[s(l.id)] || []).reduce((t, r) => t + num(r.store_out_qty), 0));

  const rowsByGd = {};
  for (const r of rows) {
    const gid = s(r.gd_id) || s((lines[s(r.gd_line_id)] || {}).goods_delivery_id);
    (rowsByGd[gid] = rowsByGd[gid] || []).push(r);
  }
  const counts = { gds: 0, reduced: 0, removed: 0, kept: 0, skippedCancelled: 0, skippedCompleted: 0 };
  const rowStatus = {};
  const deltas = [];
  for (const gid of Object.keys(rowsByGd).sort(idCmp)) {
    const g = gds[gid] || {};
    const gRows = rowsByGd[gid];
    if (s(g.gd_status) === "Cancelled") {
      counts.skippedCancelled++;
      for (const r of gRows) if (s(r.line_status) !== "Cancelled") rowStatus[s(r.id)] = "Cancelled";
      continue;
    }
    if (s(g.gd_status) === "Completed") {
      counts.skippedCompleted++;
      for (const r of gRows) if (s(r.line_status) !== "Cancelled") rowStatus[s(r.id)] = "Completed";
      continue;
    }
    const here = {};
    for (const r of gRows) if (s(r.line_status) !== "Cancelled") here[s(r.gd_line_id)] = true;
    const tops = Object.keys(here).filter((id) => lines[id] && !(s(lines[id].parent_id) && here[s(lines[id].parent_id)])).sort(idCmp);
    const outcome = {}, plans = [], removed = [];
    let removedTops = 0;
    for (const id of tops) {
      const l = lines[id];
      const kids = kidsOf[id] || [];
      if (kids.length) {
        const full = [], none = [];
        for (const k of kids) {
          const p = pickedOf(k);
          if (p > num(k.gd_qty) + EPS) return fail("PK_FC_OVERPICK", gdNo(k) + " " + lineName(k) + ": picked " + r8(p) + " is more than the delivery quantity " + r8(num(k.gd_qty)) + ".");
          if (p >= num(k.gd_qty) - EPS) full.push(k); else if (p <= EPS) none.push(k);
        }
        if (/*M:bundle*/ full.length === kids.length) {
          outcome[id] = "kept";
          for (const x of [l].concat(kids)) { outcome[s(x.id)] = "kept"; plans.push({ l: x, bundle: true }); }
        } else if (none.length === kids.length) {
          outcome[id] = "removed"; removedTops++;
          for (const x of [l].concat(kids)) { outcome[s(x.id)] = "removed"; removed.push(s(x.id)); }
        } else {
          return fail("PK_BUNDLE_SHORT", gdNo(l) + " " + lineName(l) + " is a bundle that is only partly picked: pick all of its items or none, then force complete.");
        }
        continue;
      }
      const P = pickedOf(l), q = num(l.gd_qty);
      if (/*M:eps*/ P > q + EPS) return fail("PK_FC_OVERPICK", gdNo(l) + " " + lineName(l) + ": picked " + P + " is more than the delivery quantity " + r8(q) + ".");
      if (/*M:remove*/ P <= EPS) { outcome[id] = "removed"; removedTops++; removed.push(id); continue; }
      const recs = recsOf[id] || [];
      const storedByKey = {};
      for (const e of mergeByKey(arr(l.temp_qty_data))) storedByKey[keyOf(e)] = e;
      const entries = /*M:merge*/ mergeByKey(recs.map((r) => {
        const e = { material_id: s(r.item_code) || s(l.material_id), location_id: s(r.target_location) || s(r.source_bin),
          batch_id: normBatch(s(r.target_batch) || s(r.batch_no) || null), handling_unit_id: s(r.handling_unit_id) || null, gd_quantity: r8(num(r.store_out_qty)) };
        const b = storedByKey[keyOf(e)];
        return b ? Object.assign({}, b, e) : e;
      }));
      for (const e of entries) e.gd_quantity = r8(e.gd_quantity);
      const reduced = P < q - EPS;
      outcome[id] = reduced ? "reduced" : "kept";
      plans.push({ l: l, P: P, q: q, recs: recs, entries: entries, reduced: reduced, allocChanged: canon(entries) !== canon(arr(l.temp_qty_data)) });
    }
    if (tops.length && removedTops === tops.length) {
      const other = (input.gdLines || []).some((x) => s(x.goods_delivery_id) === gid && !s(x.parent_id) && !here[s(x.id)] && (s(x.material_id) || s(x.item_bundle_id)));
      if (!other) return fail("PK_FC_GD_UNPICKED", s(g.delivery_no) + " has nothing picked on " + toNo + ": cancel it first, then force complete.");
    }
    for (const r of gRows) {
      if (s(r.line_status) === "Cancelled") continue;
      const o = outcome[s(r.gd_line_id)];
      rowStatus[s(r.id)] = o === "removed" ? "Cancelled" : "Completed";
    }
    for (const id of tops) {
      if (outcome[id] === "removed") counts.removed++;
      else if (outcome[id] === "reduced") counts.reduced++;
      else if (outcome[id] === "kept") counts.kept++;
    }
    const changed = removed.length > 0 || plans.some((p) => p.reduced || p.allocChanged || s(p.l.picking_status) !== "Completed");
    if (!changed) continue;
    const cells = {}, base = {}, so = {};
    for (const p of plans) {
      const l = p.l, id = s(l.id);
      const c = { picking_status: "Completed", is_force_complete: 1, plan_qty: q8(num(l.gd_qty)), plan_temp_qty_data: s(l.temp_qty_data) || "[]",
        plan_view_stock: l.view_stock === undefined || l.view_stock === null ? "" : String(l.view_stock) };
      if (!p.bundle && (p.allocChanged || p.reduced)) {
        c.temp_qty_data = JSON.stringify(p.entries);
        c.view_stock = buildViewStock(p.entries, uomFromViewStock(l.view_stock), names);
        const hu = huData(l, p.recs);
        if (hu !== null) c.temp_hu_data = hu;
      }
      if (!p.bundle && p.reduced) {
        const P = p.P, q = p.q;
        c.gd_qty = q8(P);
        c.base_qty = /*M:base*/ q8(num(l.base_qty) * P / q);
        const delivered = num(l.gd_initial_delivered_qty) + P;
        c.gd_delivered_qty = q8(delivered);
        c.gd_undelivered_qty = q8(Math.max(0, num(l.gd_order_quantity) - delivered));
      }
      cells[id] = c;
      base[id] = lineFingerprint(l);
      if (s(l.so_line_item_id)) so[s(l.so_line_item_id)] = true;
    }
    for (const id of removed) {
      base[id] = lineFingerprint(lines[id]);
      if (s(lines[id].so_line_item_id)) so[s(lines[id].so_line_item_id)] = true;
    }
    deltas.push({ gi: deltas.length, gd_id: gid, gd_no: s(g.delivery_no), cells: cells, removed: removed, base: base,
      so_line_ids: Object.keys(so).sort(idCmp), weight: Object.keys(cells).length + removed.length });
  }
  counts.gds = deltas.length;
  const rowPatch = rows.filter((r) => rowStatus[s(r.id)]).map((r) => ({ id: s(r.id), line_status: rowStatus[s(r.id)], pending_process_qty: "0.00000000" }));
  const recMaxId = ownRecords.map((r) => s(r.id)).sort(idCmp).pop() || "";
  return { ok: true, deltas: deltas, rowPatch: rowPatch, counts: counts,
    snapshot: { rowsFp: rowsFingerprint(input.rows || []), recCount: ownRecords.length, recSum: q8(ownRecords.reduce((t, r) => t + num(r.store_out_qty), 0)), recMaxId: recMaxId } };
}

module.exports = { fcPlan, rowsFingerprint, lineFingerprint, EPS, q8 };
