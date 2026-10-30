// LOT_V2_COMMIT - L3_RESERVATION (reserved requests, Item Assembly & BOM/TransferRequest/RESERVED_REQUEST_DESIGN.md): PREPARE's RR
// part, written after the engine moved the stock (phase B, before L4).
//   DISPATCH     the IA's released reservation rows Cancelled under the operation's marker, by id
//   RECEIVE      the IA's new rows at the staging bin (Allocated, once per job_line_key, IA_HOLD's columns), the IA lines' picks there
//                (the form's pick shape, today's balance ids) and stock summary, the transfer lines' defects
//   CANCEL_BACK  the IA's new rows at the picked bins, and the IA lines' picks there
// An IA line keeps its picks at the staging bin from earlier requests; the picks this transfer dispatched give way to its own, tagged
// iatr_lot_id so a resumed run finds them. A row / line already at its target is done (a resumed run never writes twice); anything
// else unexpected goes to review. The reads are one-row SQL results: ctx { now, ia, lines, holds, lot, items, uoms } and
// look { bal, bbal, bins, batches }.
const L3R_STEP = "L3_RESERVATION";
const L3R_SLICE = 250;
// IA_HOLD's add_node_HDrows columns (scratchpad/iasc/res01/build_hold.py ROW_COLS)
const L3R_ADD_COLS = ["doc_type", "status", "doc_id", "doc_no", "doc_line_id", "material_id", "bin_location", "batch_id", "item_uom", "reserved_qty", "open_qty",
  "delivered_qty", "from_category", "plant_id", "organization_id", "reserved_date", "job_line_key", "parent_id", "parent_no", "parent_line_id", "target_gd_id",
  "source_reserved_id", "item_code", "item_name", "item_desc"];
const l3rQ8T = (v) => {
  const x = parseFloat(v);
  return (isFinite(x) ? x : 0).toFixed(8);
};
const l3rNum = (v) => {
  const x = parseFloat(v);
  return isFinite(x) ? Number(x.toFixed(8)) : 0;
};
const l3rOne = (rows) => lotRows(rows)[0] || {};
const l3rPart = (entry, rrPartRows) => {
  const rr = lotJoinChunks(rrPartRows, entry.partPrefix + "RR|");
  return rr && typeof rr === "object" && ["DISPATCH", "RECEIVE", "CANCEL_BACK"].indexOf(s(rr.kind)) >= 0 ? rr : null;
};
// the line's picks that stay: at the staging bin, from an earlier request (or placed there by hand)
const l3rKept = (line, rr, entry) => lotJsonList(line && line.temp_qty_data)
  .filter((p) => p && typeof p === "object" && s(p.location_id) === s(rr.stagingBin) && s(p.iatr_lot_id) !== s(entry.lotId));
const l3rHash = (text) => lotFpHash(text) + ":" + text.length;
// the request's log (IA_TRANSFER_REQUEST's iatrLog: a JSON list; an unreadable one kept as text before what follows)
const l3rLog = (text) => {
  const t = s(text);
  if (!t) return [];
  try {
    const v = JSON.parse(t);
    return Array.isArray(v) ? v : [{ op: "UNREADABLE", text: t.slice(0, 2000) }];
  } catch (e) {
    return [{ op: "UNREADABLE", text: t.slice(0, 2000) }];
  }
};
const l3rLogged = (text, marker) => l3rLog(text).some((x) => x && x.op === "DISPATCH" && s(x.marker) === s(marker));
// rrSwapPlan's label "<bin>" or "<bin> / <batch>" (ids) back to its key
const l3rKeyOf = (label) => {
  const p = s(label).split(" / ");
  const out = { bin: s(p[0]), batch: s(p[1]) };
  return out;
};
// the IA form's stock summary (sc_main.js scAllocate)
const l3rSummary = (picks, uom, binName, batchNo) => {
  if (!picks.length) return "";
  const total = l3rNum(picks.reduce((t, p) => t + l3rNum(p.sm_quantity), 0));
  return "Total: " + total + " " + uom + "\n\nDETAILS:\n" + picks.map((p, i) => (i + 1) + ". " + (binName[s(p.location_id)] || s(p.location_id)) + ": " + l3rNum(p.sm_quantity)
    + " " + uom + " (UNR)" + (s(p.batch_id) ? "\n[" + (batchNo[s(p.batch_id)] || s(p.batch_id)) + "]" : "")).join("\n");
};
// what the lookups need (ids only reach the SQL): the new picks' items, every final pick's bin and batch, the IA's plant
const commitL3RKeys = function commitL3RKeys(entry, rrPartRows, ctxRows) {
  const none = { need: "NO", mats: "0", locs: "0", batches: "0", plant: "0" };
  const rr = l3rPart(entry, rrPartRows);
  if (!rr || rr.kind === "DISPATCH") return none;
  const c = l3rOne(ctxRows);
  const lines = byId(c.lines);
  const mats = {};
  const locs = {};
  const batches = {};
  for (const lineId of Object.keys(rr.iaPicks || {})) {
    for (const p of list(rr.iaPicks[lineId])) {
      if (!digits(p.material_id) || !digits(p.location_id) || (s(p.batch_id) && !digits(p.batch_id))) continue;
      mats[s(p.material_id)] = 1;
      locs[s(p.location_id)] = 1;
      if (s(p.batch_id)) batches[s(p.batch_id)] = 1;
    }
    for (const p of l3rKept(lines[lineId], rr, entry)) {
      if (digits(p.location_id)) locs[s(p.location_id)] = 1;
      if (digits(p.batch_id)) batches[s(p.batch_id)] = 1;
    }
  }
  const join = (o) => Object.keys(o).join(",") || "0";
  const out = { need: Object.keys(locs).length ? "YES" : "NO", mats: join(mats), locs: join(locs), batches: join(batches),
    plant: c.ia && digits(c.ia.plant) ? s(c.ia.plant) : "0" };
  return out;
};
const commitL3RPlan = function commitL3RPlan(entry, rrPartRows, ctxRows, lookRows) {
  const base = { route: "GO", cancelSlices: [], addSlices: [], iaSlices: [], lotSlices: [], logSlices: [], linkSlices: [], counts: { cancel: 0, add: 0, ia: 0, lot: 0, log: 0, link: 0 },
    expect: {}, jobRows: [],
    needJobUpd: "NO", result_code: "", result_message: "", job_status: "COMMITTING_LOT" };
  const review = (why) => Object.assign(base, stepEnd(entry, L3R_STEP, why, true));
  const rr = l3rPart(entry, rrPartRows);
  if (!rr) return review("the RR part of the prepared payload is missing or unreadable");
  const c = l3rOne(ctxRows);
  const ia = c.ia && typeof c.ia === "object" ? c.ia : {};
  if (!digits(ia.id) || s(rr.iaId) !== s(ia.id)) return review("the request's Item Assembly " + s(rr.iaId) + " is not this transfer's (" + (s(ia.id) || "none") + ")");
  const expect = { kind: s(rr.kind), marker: s(rr.marker), cancel: [], keys: [], ia: {}, lot: {} };
  const finish = (cancel, add, iaRows, lotLines, logRows, linkRows) => {
    const logs = logRows || [];
    const links = linkRows || [];
    Object.assign(base, { cancelSlices: slicesOf(cancel, L3R_SLICE), addSlices: slicesOf(add, L3R_SLICE), iaSlices: slicesOf(iaRows, L3R_SLICE),
      lotSlices: slicesOf(lotLines, L3R_SLICE), logSlices: slicesOf(logs, L3R_SLICE), linkSlices: slicesOf(links, L3R_SLICE), counts: { cancel: cancel.length, add: add.length,
        ia: iaRows.length, lot: lotLines.length, log: logs.length, link: links.length }, expect: expect });
    return base;
  };
  if (rr.kind === "DISPATCH") {
    const rows = byId(c.holds);
    const cancel = [];
    for (const id of list(rr.cancelRows).map(s)) {
      const cur = rows[id];
      if (!cur) return review("reservation row " + id + " was not read");
      expect.cancel.push(id);
      if (s(cur.status) === "Cancelled" && s(cur.job_line_key) === s(rr.marker)) continue;
      if (s(cur.status) !== "Allocated") return review("reservation row " + id + " is " + (s(cur.status) || "without a status") + ", not Allocated");
      cancel.push({ id: id, status: "Cancelled", job_line_key: s(rr.marker) });
    }
    // the bins to count (the design's section 4, D9): the picks away from the reservation, in the request's log once (by the marker)
    const count = list(rr.countBins).filter((x) => x && typeof x === "object");
    const logRows = [];
    if (count.length) {
      expect.log = s(rr.marker);
      if (!l3rLogged(c.log, rr.marker)) {
        logRows.push({ id: s(entry.lotId), request_log: JSON.stringify(l3rLog(c.log).concat([{ at: s(c.now), op: "DISPATCH", marker: s(rr.marker),
          count: count.map((x) => ({ item: s(x.item), from: l3rKeyOf(x.pickedFrom), reserved: list(x.reservedAt).map(l3rKeyOf) })) }])) });
      }
    }
    return finish(cancel, [], [], [], logRows);
  }
  const have = {};
  for (const r of lotRows(c.holds)) if (s(r.job_line_key)) have[s(r.job_line_key)] = (have[s(r.job_line_key)] || 0) + 1;
  const items = byId(c.items);
  const org = s(ia.org) || s(entry.organizationId);
  const add = [];
  for (const h of list(rr.newHoldRows)) {
    const k = s(h.job_line_key);
    if (!/^IATR\|[0-9]{1,20}\|[0-9]+$/.test(k)) return review("a new reservation row has no valid key");
    if (have[k] > 1) return review("reservation key " + k + " was written twice");
    expect.keys.push(k);
    if (have[k] === 1) continue;
    if (!digits(h.material_id) || !digits(h.bin_location) || (s(h.batch_id) && !digits(h.batch_id))) return review("new reservation row " + k + " has no valid item, bin or batch");
    const it = items[s(h.material_id)] || {};
    add.push({ doc_type: "Item Assembly", status: "Allocated", doc_id: s(ia.id), doc_no: s(ia.no), doc_line_id: s(h.doc_line_id), material_id: s(h.material_id),
      bin_location: s(h.bin_location), batch_id: s(h.batch_id) || null, item_uom: s(h.item_uom) || null, reserved_qty: l3rQ8T(h.reserved_qty), open_qty: l3rQ8T(h.open_qty),
      delivered_qty: l3rQ8T(0), from_category: s(h.from_category) || "Unrestricted", plant_id: s(ia.plant) || null, organization_id: org, reserved_date: s(c.now), job_line_key: k,
      parent_id: "", parent_no: "", parent_line_id: "", target_gd_id: "", source_reserved_id: "", item_code: s(it.material_code), item_name: s(it.material_name),
      item_desc: s(it.material_desc) });
  }
  const look = l3rOne(lookRows);
  const balOf = {};
  for (const b of lotRows(look.bal).concat(lotRows(look.bbal))) balOf[s(b.material_id) + "|" + s(b.location_id) + "|" + s(b.batch_id)] = b;
  const binName = {};
  for (const b of lotRows(look.bins)) binName[s(b.id)] = s(b.name);
  const batchNo = {};
  for (const b of lotRows(look.batches)) batchNo[s(b.id)] = s(b.batch_number);
  const uomName = {};
  for (const u of lotRows(c.uoms)) uomName[s(u.id)] = s(u.uom_name);
  const lines = byId(c.lines);
  const iaRows = [];
  for (const lineId of Object.keys(rr.iaPicks || {})) {
    const line = lines[lineId];
    if (!line) return review("Item Assembly line " + lineId + " was not read");
    const fresh = [];
    for (const p of list(rr.iaPicks[lineId])) {
      const b = balOf[s(p.material_id) + "|" + s(p.location_id) + "|" + s(p.batch_id)];
      if (!b || !digits(b.id)) return review("no balance row at the new bin for Item Assembly line " + lineId);
      fresh.push({ material_id: s(p.material_id), location_id: s(p.location_id), storage_location_id: null, batch_id: s(p.batch_id) || null, balance_id: s(b.id),
        sm_quantity: l3rNum(p.sm_quantity), category: "Unrestricted", plant_id: s(ia.plant), organization_id: org, is_deleted: 0, expired_date: p.expired_date || null,
        manufacturing_date: p.manufacturing_date || null, unrestricted_qty: l3rNum(b.unrestricted_qty), balance_quantity: l3rNum(b.balance_quantity), iatr_lot_id: s(entry.lotId) });
    }
    const target = l3rKept(line, rr, entry).concat(fresh);
    const text = target.length ? JSON.stringify(target) : "";
    const summary = l3rSummary(target, uomName[s(line.quantity_uom)] || "", binName, batchNo);
    expect.ia[lineId] = { picks: l3rHash(text), summary: l3rHash(summary) };
    if (s(line.temp_qty_data) === text && s(line.stock_summary) === summary) continue;
    iaRows.push({ id: lineId, temp_qty_data: text, total_quantity: l3rQ8T(target.reduce((t, x) => t + l3rNum(x.sm_quantity), 0)), stock_summary: summary });
  }
  const lotLines = [];
  if (rr.kind === "RECEIVE") {
    const lot = byId(c.lot);
    for (const d of list(rr.lineDefects)) {
      const id = s(d.id);
      if (!lot[id]) return review("transfer line " + id + " was not read");
      const want = { defect_qty: l3rQ8T(d.defect_qty), defect_reason: s(d.defect_reason), defect_detail: s(d.defect_detail) };
      expect.lot[id] = want;
      const cur = lot[id];
      if (l3rQ8T(cur.defect_qty) === want.defect_qty && s(cur.defect_reason) === want.defect_reason && s(cur.defect_detail) === want.defect_detail) continue;
      lotLines.push(Object.assign({ id: id }, want));
    }
  }
  // a cancelled replacement gives the IA's link (its list's Transfer Request column: the latest open or received request) back to its
  // received request (IA_TRANSFER_REQUEST's CANCEL does the same before a dispatch); resumed after the write, it is already there
  const linkRows = [];
  const recv = c.recv && typeof c.recv === "object" && digits(c.recv.id) ? c.recv : null;
  if (rr.kind === "CANCEL_BACK" && recv && (s(ia.link) === s(entry.lotId) || s(ia.link) === s(recv.id))) {
    expect.link = s(recv.id);
    if (s(ia.link) === s(entry.lotId)) linkRows.push({ id: s(ia.id), transfer_request_id: s(recv.id), transfer_request_no: s(recv.no) });
  }
  return finish([], add, iaRows, lotLines, [], linkRows);
};
// after the writes: every expected row / line at its target -> L3_RESERVATION DONE; else review
const commitL3RCheck = function commitL3RCheck(entry, backRows, expect) {
  const e = expect || {};
  const c = l3rOne(backRows);
  const review = (why) => stepEnd(entry, L3R_STEP, why, true);
  const rows = byId(c.holds);
  for (const id of list(e.cancel)) if (!rows[id] || s(rows[id].status) !== "Cancelled" || s(rows[id].job_line_key) !== s(e.marker)) return review("reservation row " + id + " is not cancelled");
  const have = {};
  for (const r of lotRows(c.holds)) if (s(r.job_line_key)) have[s(r.job_line_key)] = (have[s(r.job_line_key)] || 0) + 1;
  for (const k of list(e.keys)) if (have[k] !== 1) return review("reservation key " + k + " is there " + (have[k] || 0) + " times");
  const lines = byId(c.lines);
  for (const id of Object.keys(e.ia || {})) {
    const cur = lines[id];
    if (!cur || l3rHash(s(cur.temp_qty_data)) !== e.ia[id].picks || l3rHash(s(cur.stock_summary)) !== e.ia[id].summary) return review("Item Assembly line " + id + " has not taken its new picks");
  }
  const lot = byId(c.lot);
  for (const id of Object.keys(e.lot || {})) {
    const cur = lot[id];
    const want = e.lot[id];
    if (!cur || l3rQ8T(cur.defect_qty) !== want.defect_qty || s(cur.defect_reason) !== want.defect_reason || s(cur.defect_detail) !== want.defect_detail) {
      return review("transfer line " + id + " has not taken its defects");
    }
  }
  if (s(e.log) && !l3rLogged(c.log, e.log)) return review("the request's log has not taken the bins to count");
  if (s(e.link) && s((c.ia || {}).link) !== s(e.link)) return review("the Item Assembly's link has not gone back to its received request");
  return stepOk(entry, L3R_STEP, e.kind, e.kind + ": the reservation follows the transfer");
};
const res = __CALL__;
console.log("commit L3R", JSON.stringify({ route: res.route, need: res.need, counts: res.counts, result: res.result_code, message: res.result_message }));
return res;
