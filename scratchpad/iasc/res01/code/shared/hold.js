// RES-01 Item Assembly raw-material holds (scratchpad/iasc/res01/RES01_PLAN.md): which picks are held, the change against the
// IA's own holds, the caps by free stock, the engine moves, the row states, recovery after a dead run, the coverage label.
// Pure, ES2015 (IA_HOLD's code nodes inline it)
const HD_CATS = { Unrestricted: "unrestricted_qty", Blocked: "block_qty" };
const HD_EPS = 0.0000001;
// a HELD ticket older than this belongs to a dead run (the IA's hold mutex)
const HD_LEASE_MS = 10 * 60 * 1000;
const HD_ID = /^[0-9]{1,20}$/;
// an operation key this workflow makes (IAH|<ia>|<n>): the only kind ever looked up in SQL
const HD_OP = /^IAH\|[0-9]{1,20}\|[0-9]{1,8}$/;
const hdS = (v) => (v === undefined || v === null ? "" : String(v));
const hdNum = (v) => {
  const x = parseFloat(v);
  return isFinite(x) ? x : 0;
};
const hdQ8 = (v) => Number(hdNum(v).toFixed(8));
const hdText = (v) => hdQ8(v).toFixed(8);
const hdParse = (t) => {
  if (Array.isArray(t)) return t;
  try {
    const x = JSON.parse(hdS(t) || "[]");
    return Array.isArray(x) ? x : [];
  } catch (e) {
    return [];
  }
};
// sql-node rows: one JSON column `j` per row (ids already text)
const hdJson = (v) => {
  if (v && typeof v === "object") return v;
  try {
    return JSON.parse(hdS(v));
  } catch (e) {
    return null;
  }
};
const hdSqlRows = (rows) => (Array.isArray(rows) ? rows : rows ? [rows] : []).map((r) => (r && r.j !== undefined ? hdJson(r.j) : null)).filter((x) => x && typeof x === "object");
const hdSqlRow = (rows) => hdSqlRows(rows)[0] || null;
// the unit is part of the key: a line whose unit changed releases its old hold and holds anew (review M2), never compares two units
const hdKey = (lineId, mat, bin, batch, cat, uom) => [hdS(lineId), hdS(mat), hdS(bin), hdS(batch), hdS(cat), hdS(uom)].join("|");
// base units per one unit of the line (the engine's rule: one conversion row of that unit); null = cannot convert
const hdFactor = (item, uomId) => {
  if (!item) return null;
  if (!hdS(uomId) || hdS(uomId) === hdS(item.based_uom)) return 1;
  const convs = Array.isArray(item.table_uom_conversion) ? item.table_uom_conversion : hdParse(item.table_uom_conversion);
  const c = convs.find((x) => x && hdS(x.alt_uom_id) === hdS(uomId));
  return c && hdNum(c.base_qty) > 0 ? hdNum(c.base_qty) : null;
};
// the holds a saved Draft wants: one fragment per line + material + bin + batch + category of its loose picks; what is not
// held and why (an item the items read did not return, serial, non-stock, handling unit, a category other than Unrestricted /
// Blocked, a unit with no conversion). The ids that reach SQL text are checked where the SQL is built (IA_HOLD's delta)
const hdWanted = (input) => {
  const items = (input && input.items) || {};
  const fragments = [];
  const byKey = {};
  const notHeld = [];
  ((input && input.lines) || []).forEach((l) => {
    if (Number(l.is_deleted) === 1) return;
    const lineId = hdS(l.id);
    const item = items[hdS(l.item_selection)];
    if (!item) return notHeld.push({ lineId: lineId, reason: "ITEM" });
    if (Number(item.stock_control) === 0) return notHeld.push({ lineId: lineId, reason: "NON_STOCK" });
    if (Number(item.serial_number_management) === 1) return notHeld.push({ lineId: lineId, reason: "SERIAL" });
    const reasons = {};
    if (hdParse(l.temp_hu_data).length) reasons.HANDLING_UNIT = 1;
    const picks = hdParse(l.temp_qty_data).filter((p) => p && hdQ8(p.sm_quantity) > 0);
    if (picks.length && hdFactor(item, l.quantity_uom) === null) reasons.UOM = 1;
    else {
      picks.forEach((p) => {
        if (hdS(p.handling_unit_id)) return void (reasons.HANDLING_UNIT = 1);
        const cat = hdS(p.category) || "Unrestricted";
        if (!HD_CATS[cat]) return void (reasons.CATEGORY = 1);
        const key = hdKey(lineId, l.item_selection, p.location_id, p.batch_id, cat, l.quantity_uom);
        if (byKey[key]) byKey[key].qty = hdQ8(byKey[key].qty + hdQ8(p.sm_quantity));
        else {
          byKey[key] = { key: key, lineId: lineId, materialId: hdS(l.item_selection), binId: hdS(p.location_id), batchId: hdS(p.batch_id), cat: cat,
            qty: hdQ8(p.sm_quantity), uomId: hdS(l.quantity_uom) };
          fragments.push(byKey[key]);
        }
      });
    }
    ["HANDLING_UNIT", "CATEGORY", "UOM"].forEach((r) => reasons[r] && notHeld.push({ lineId: lineId, reason: r }));
  });
  const wanted = { fragments: fragments, notHeld: notHeld };
  return wanted;
};
// the IA's own live holds (Allocated rows) by fragment key
const hdHeld = (rows) => {
  const out = {};
  (rows || []).forEach((r) => {
    if (hdS(r.status) !== "Allocated" || Number(r.is_deleted) === 1) return;
    const key = hdKey(r.doc_line_id, r.material_id, r.bin_location, r.batch_id, hdS(r.from_category) || "Unrestricted", r.item_uom);
    const h = out[key] || (out[key] = { qty: 0, rows: [] });
    h.qty = hdQ8(h.qty + hdNum(r.open_qty));
    h.rows.push(r);
  });
  return out;
};
const hdFragOfRow = (r) => ({ lineId: hdS(r.doc_line_id), materialId: hdS(r.material_id), binId: hdS(r.bin_location), batchId: hdS(r.batch_id),
  cat: hdS(r.from_category) || "Unrestricted", uomId: hdS(r.item_uom) });
// what to hold more of (only the difference) and what to release (its rows closed, one row kept for what stays wanted)
const hdDelta = (fragments, held) => {
  const want = {};
  (fragments || []).forEach((f) => (want[f.key] = f));
  const holds = [];
  (fragments || []).forEach((f) => {
    const have = held[f.key] ? held[f.key].qty : 0;
    if (f.qty > have + HD_EPS) holds.push({ key: f.key, frag: f, qty: hdQ8(f.qty - have) });
  });
  const releases = [];
  Object.keys(held || {}).forEach((key) => {
    const have = held[key].qty;
    const keep = want[key] ? hdQ8(Math.min(want[key].qty, have)) : 0;
    if (have > keep + HD_EPS) releases.push({ key: key, rows: held[key].rows, releaseQty: hdQ8(have - keep), keepQty: keep, frag: hdFragOfRow(held[key].rows[0]) });
  });
  const delta = { holds: holds, releases: releases };
  return delta;
};
// each hold capped at what is free in its bucket at that bin (and batch), in the line's unit; holds sharing one bin take it in
// line order; what this run releases is free again (the release moves run first)
const hdCap = (holds, balances, items, releases) => {
  const pool = {};
  const pk = (f) => [hdS(f.materialId), hdS(f.binId), hdS(f.batchId)].join("|");
  (balances || []).forEach((b) => {
    pool[[hdS(b.material_id), hdS(b.location_id), hdS(b.batch_id)].join("|")] = { Unrestricted: Math.max(0, hdNum(b.unrestricted_qty)), Blocked: Math.max(0, hdNum(b.block_qty)) };
  });
  (releases || []).forEach((r) => {
    const factor = hdFactor((items || {})[r.frag.materialId], r.frag.uomId) || 1;
    const p = pool[pk(r.frag)] || (pool[pk(r.frag)] = { Unrestricted: 0, Blocked: 0 });
    p[r.frag.cat] = hdQ8((p[r.frag.cat] || 0) + hdQ8(r.releaseQty) * factor);
  });
  const out = [];
  const short = [];
  (holds || []).forEach((h) => {
    const f = h.frag;
    const factor = hdFactor((items || {})[f.materialId], f.uomId);
    const p = pool[pk(f)];
    const free = p && factor ? Math.floor(((p[f.cat] || 0) / factor) * 1e8 + HD_EPS) / 1e8 : 0;
    const take = hdQ8(Math.min(h.qty, free));
    if (take > HD_EPS) {
      out.push(Object.assign({}, h, { qty: take }));
      p[f.cat] = hdQ8(p[f.cat] - take * factor);
    }
    if (h.qty - take > HD_EPS) short.push({ key: h.key, short: hdQ8(h.qty - take) });
  });
  const capped = { holds: out, short: short };
  return capped;
};
// the engine moves of one operation: releases first (Reserved back to their category), then holds (category into Reserved);
// isMovingInv 1 (no costing), the ADD priced from its SUBTRACT; type IA-H, which IA_REVERT ('IA' / 'IA-R') never reads
const hdMoves = (holds, releases, ctx) => {
  const out = [];
  const base = (f, qty) => ({ material_id: f.materialId, location_id: f.binId, batch_id: hdS(f.batchId) || null, plant_id: ctx.plantId, organization_id: ctx.orgId,
    quantity: hdQ8(qty), material_uom: f.uomId, isMovingInv: 1, transaction_type: "IA-H", trx_no: ctx.iaNo + "/H", parent_trx_no: "", doc_date: ctx.docDate });
  (releases || []).forEach((r, i) => {
    const k = "X" + (i + 1);
    out.push(Object.assign(base(r.frag, r.releaseQty), { movement_key: k, direction: "SUBTRACT", inventory_category: "Reserved" }));
    out.push(Object.assign(base(r.frag, r.releaseQty), { movement_key: k + ".2", direction: "ADD", inventory_category: r.frag.cat, unit_price_from: k }));
  });
  (holds || []).forEach((h, i) => {
    const k = "H" + (i + 1);
    out.push(Object.assign(base(h.frag, h.qty), { movement_key: k, direction: "SUBTRACT", inventory_category: h.frag.cat }));
    out.push(Object.assign(base(h.frag, h.qty), { movement_key: k + ".2", direction: "ADD", inventory_category: "Reserved", unit_price_from: k }));
  });
  return out;
};
// the rows written BEFORE the move: new holds and kept remainders as Processing (every reader skips them), the released rows
// marked Releasing; each carries the operation key, so a dead run is resolved from the engine's record of it
const hdRows = (holds, releases, ia, opKey, now) => {
  const add = [];
  const mark = [];
  let n = 0;
  const row = (f, qty, source) => ({ doc_type: "Item Assembly", status: "Processing", doc_id: hdS(ia.id), doc_no: hdS(ia.no), doc_line_id: hdS(f.lineId), material_id: hdS(f.materialId),
    bin_location: hdS(f.binId), batch_id: hdS(f.batchId) || null, item_uom: hdS(f.uomId), reserved_qty: hdText(qty), open_qty: hdText(qty), delivered_qty: hdText(0),
    from_category: hdS(f.cat), plant_id: hdS(ia.plantId), organization_id: hdS(ia.orgId), reserved_date: hdS(now), job_line_key: opKey + "|" + ++n, parent_id: "", parent_no: "",
    parent_line_id: "", target_gd_id: "", source_reserved_id: hdS(source) });
  (holds || []).forEach((h) => add.push(row(h.frag, h.qty, "")));
  (releases || []).forEach((r) => {
    if (r.keepQty > HD_EPS) add.push(row(r.frag, r.keepQty, r.rows[0] && r.rows[0].id));
    r.rows.forEach((x) => mark.push({ id: hdS(x.id), status: "Releasing", job_line_key: opKey + "|" + hdS(x.id) }));
  });
  const rowsOut = { add: add, mark: mark };
  return rowsOut;
};
// after the engine answer: DONE -> new rows Allocated, released rows Cancelled (open 0, reserved kept as the released amount);
// NOTHING moved -> new rows soft-deleted, released rows Allocated again; UNCERTAIN -> left for the next run
const hdFinish = (outcome, rows) => {
  const out = { publish: [], close: [], drop: [], restore: [] };
  (rows || []).forEach((r) => {
    const st = hdS(r.status);
    if (outcome === "DONE") {
      if (st === "Processing") out.publish.push({ id: hdS(r.id), status: "Allocated" });
      if (st === "Releasing") out.close.push({ id: hdS(r.id), status: "Cancelled", open_qty: hdText(0), reserved_qty: r.reserved_qty });
    } else if (outcome === "NOTHING") {
      if (st === "Processing") out.drop.push({ id: hdS(r.id), is_deleted: 1 });
      if (st === "Releasing") out.restore.push({ id: hdS(r.id), status: "Allocated" });
    }
  });
  return out;
};
const hdOpOf = (r) => hdS(r.job_line_key).replace(/\|[^|]*$/, "");
// the operations a dead run left rows for (Processing / Releasing)
const hdOpsOf = (rows) => (rows || []).filter((r) => hdS(r.status) === "Processing" || hdS(r.status) === "Releasing").map(hdOpOf)
  .filter((op, i, all) => HD_OP.test(op) && all.indexOf(op) === i);
// state = { op: { done, intents } } read from the engine's own rows: DONE -> finish; no intent -> nothing moved; else uncertain
const hdRecover = (rows, state) => hdOpsOf(rows).map((op) => {
  const st = (state || {})[op] || {};
  const outcome = hdNum(st.done) > 0 ? "DONE" : hdNum(st.intents) === 0 ? "NOTHING" : "UNCERTAIN";
  const one = { op: op, outcome: outcome, rows: rows.filter((r) => hdOpOf(r) === op && (hdS(r.status) === "Processing" || hdS(r.status) === "Releasing")) };
  return one;
});
// after completion (CLOSE): what it issued from Reserved (base units by material|bin|batch) closes the IA's own Allocated rows: first
// as the completion's own split took them (used: base units by line|material|bin|batch|category, split.js), then any rest in id
// order: a used row -> Delivered (reserved = delivered = used, open 0); a partly used one -> Delivered for the used part, its
// remainder released; an unused one released whole; more issued than was held is named (another owner's stock, or drift)
const hdIdOrder = (a, b) => (hdS(a.id).length - hdS(b.id).length) || (hdS(a.id) < hdS(b.id) ? -1 : hdS(a.id) > hdS(b.id) ? 1 : 0);
const hdClose = (rows, consumed, items, used) => {
  const left = {};
  Object.keys(consumed || {}).forEach((k) => (left[k] = hdNum(consumed[k])));
  const want = {};
  Object.keys(used || {}).forEach((k) => (want[k] = hdNum(used[k])));
  const deliver = [];
  const releases = [];
  const own = (rows || []).filter((r) => hdS(r.status) === "Allocated" && Number(r.is_deleted) !== 1).sort(hdIdOrder).map((r) => {
    const f = hdFragOfRow(r);
    const x = { r: r, f: f, pk: [f.materialId, f.binId, f.batchId].join("|"), split: [f.lineId, f.materialId, f.binId, f.batchId, f.cat].join("|"),
      factor: hdFactor((items || {})[f.materialId], f.uomId) || 1, open: hdQ8(r.open_qty), useBase: 0 };
    return x;
  });
  own.forEach((x) => {
    const take = Math.max(0, Math.min(x.open * x.factor, want[x.split] || 0, left[x.pk] || 0));
    want[x.split] = hdQ8((want[x.split] || 0) - take);
    left[x.pk] = hdQ8((left[x.pk] || 0) - take);
    x.useBase = take;
  });
  own.forEach((x) => {
    const take = Math.max(0, Math.min(hdQ8(x.open * x.factor - x.useBase), left[x.pk] || 0));
    left[x.pk] = hdQ8((left[x.pk] || 0) - take);
    x.useBase += take;
  });
  own.forEach((x) => {
    const r = x.r;
    const f = x.f;
    const open = x.open;
    const used = hdQ8(x.useBase / x.factor);
    if (used > HD_EPS) deliver.push({ id: hdS(r.id), status: "Delivered", delivered_qty: hdText(used), reserved_qty: hdText(used), open_qty: hdText(0) });
    const rest = hdQ8(open - used);
    if (rest > HD_EPS) releases.push({ source: hdS(r.id), whole: used <= HD_EPS, releaseQty: rest, frag: f, row: r });
  });
  const over = Object.keys(left).filter((k) => left[k] > HD_EPS).map((k) => ({ key: k, qty: hdQ8(left[k]) }));
  const plan = { deliver: deliver, releases: releases, over: over };
  return plan;
};
// CLOSE reads (kind OUT: issued from Reserved, base units by material|bin|batch; kind DELIVERED: this cycle's Delivered rows):
// what is left to attribute, so a re-run never delivers the same consumption twice; more delivered than issued is named
const hdNet = (reads, items) => {
  const net = {};
  (reads || []).forEach((x) => {
    if (hdS(x.kind) === "OUT") net[hdS(x.key)] = hdQ8((net[hdS(x.key)] || 0) + hdNum(x.base));
  });
  (reads || []).forEach((d) => {
    if (hdS(d.kind) !== "DELIVERED") return;
    const pk = [hdS(d.material_id), hdS(d.bin_location), hdS(d.batch_id)].join("|");
    net[pk] = hdQ8((net[pk] || 0) - hdNum(d.delivered_qty) * (hdFactor((items || {})[hdS(d.material_id)], d.item_uom) || 1));
  });
  const under = [];
  Object.keys(net).forEach((k) => {
    if (net[k] < -HD_EPS) under.push({ key: k, qty: hdQ8(-net[k]) });
    if (net[k] < 0) net[k] = 0;
  });
  const out = { net: net, under: under };
  return out;
};
// the rows a CLOSE writes before its release move: a whole release marks the row Releasing; a partly used row's remainder is a
// new row, Releasing from the start (Cancelled once the stock moved back; Allocated again if nothing moved)
const hdCloseRows = (plan, ia, opKey, now) => {
  const add = [];
  const mark = [];
  let n = 0;
  (plan.releases || []).forEach((x) => {
    if (x.whole) return void mark.push({ id: x.source, status: "Releasing", job_line_key: opKey + "|" + x.source });
    const f = x.frag;
    add.push({ doc_type: "Item Assembly", status: "Releasing", doc_id: hdS(ia.id), doc_no: hdS(ia.no), doc_line_id: hdS(f.lineId), material_id: hdS(f.materialId),
      bin_location: hdS(f.binId), batch_id: hdS(f.batchId) || null, item_uom: hdS(f.uomId), reserved_qty: hdText(x.releaseQty), open_qty: hdText(x.releaseQty),
      delivered_qty: hdText(0), from_category: hdS(f.cat), plant_id: hdS(ia.plantId), organization_id: hdS(ia.orgId), reserved_date: hdS(now), job_line_key: opKey + "|" + ++n,
      parent_id: "", parent_no: "", parent_line_id: "", target_gd_id: "", source_reserved_id: x.source });
  });
  const out = { add: add, mark: mark };
  return out;
};
// required / reserved / short per component line (required = required_qty, else the line's quantity) and the label
const hdStatus = (lines, rows, items) => {
  const held = {};
  (rows || []).forEach((r) => {
    if (hdS(r.status) !== "Allocated" || Number(r.is_deleted) === 1) return;
    held[hdS(r.doc_line_id)] = hdQ8((held[hdS(r.doc_line_id)] || 0) + hdNum(r.open_qty));
  });
  const out = [];
  let need = 0;
  let full = 0;
  let any = 0;
  (lines || []).forEach((l) => {
    if (Number(l.is_deleted) === 1) return;
    const item = (items || {})[hdS(l.item_selection)];
    if (item && Number(item.stock_control) === 0) return;
    // an unknown item is not reservable (shown with the reason, not counted), like a serial one
    const serial = !item || Number(item.serial_number_management) === 1;
    const hu = !serial && hdParse(l.temp_hu_data).length > 0;
    const required = hdQ8(hdS(l.required_qty) !== "" ? l.required_qty : l.total_quantity);
    const reserved = serial ? 0 : hdQ8(held[hdS(l.id)] || 0);
    const short = serial ? 0 : hdQ8(Math.max(0, required - reserved));
    out.push({ lineId: hdS(l.id), required: required, reserved: reserved, short: short, reason: !item ? "ITEM" : serial ? "SERIAL" : hu ? "HANDLING_UNIT" : "" });
    if (!serial && required > HD_EPS) {
      need += 1;
      if (short <= HD_EPS) full += 1;
      if (reserved > HD_EPS) any += 1;
    }
  });
  // NONE only when nothing is held either (review M3: a completed IA labelled NONE is never closed again)
  const holding = Object.keys(held).some((k) => held[k] > HD_EPS);
  const summary = { status: need === 0 ? (holding ? "FULL" : "NONE") : full === need ? "FULL" : any === 0 ? "SHORT" : "PARTIAL", lines: out };
  return summary;
};
if (typeof module !== "undefined") module.exports = { HD_CATS, HD_LEASE_MS, HD_ID, HD_OP, hdClose, hdCloseRows, hdNet, hdS, hdNum, hdQ8, hdText, hdParse, hdJson, hdSqlRows, hdSqlRow, hdKey, hdFactor, hdWanted, hdHeld, hdDelta, hdCap, hdMoves, hdRows, hdFinish, hdOpsOf, hdRecover, hdStatus };
