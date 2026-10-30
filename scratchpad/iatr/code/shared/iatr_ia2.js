// IA -> Location Transfer Request from a reserved Item Assembly (Item Assembly & BOM/TransferRequest/RESERVED_REQUEST_DESIGN.md):
// IA_TRANSFER_REQUEST v8's decisions. Needs iatr_rules.js, iatr_ia.js and iatr_reserve.js before it (iatr_ia.js stays as the IA
// form inlines it).
const IATR_OPS2 = ["CREATE", "REFRESH", "REPLACE", "DEFECT", "CANCEL", "STATUS"];

// RR1: a reserved request's lines as the IA's reservation gives them (line, item, unit, quantity, the reserved bins and batches); the
// request stores it (source_ia_fp), STATUS compares it with the reservation now (stale = refresh)
const rrReqFp = function rrReqFp(reqLines) {
  const rows = (Array.isArray(reqLines) ? reqLines : []).map((l) => [iatrId(l.source_ia_line_id), iatrId(l.item_selection), iatrId(l.quantity_uom), iatrQ8(l.requested_qty).toFixed(8),
    (Array.isArray(l.picks) ? l.picks : []).map((p) => iatrId(p.location_id) + "|" + iatrS(p.batch_id) + "|" + iatrQ8(p.sm_quantity).toFixed(8)).sort()]);
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return "RR1:" + rows.length + ":" + iatrHash(JSON.stringify(rows));
};

// the request's Location Transfer lines (iatrLotLines' columns): Requested Qty = the reservation, the picks = the reserved bins and
// batches, each with the IA line's own pick there (its balance id and dates); ctx: { iaLines, items, uoms, storage, bin, plant, org }
const rrLotLines = function rrLotLines(reqLines, ctx) {
  const c = ctx || {};
  const byId = {};
  for (const l of Array.isArray(c.iaLines) ? c.iaLines : []) if (l && iatrS(l.id)) byId[iatrId(l.id)] = l;
  const list = Array.isArray(reqLines) ? reqLines : [];
  const base = iatrLotLines(list.map((r) => {
    const src = byId[iatrId(r.source_ia_line_id)] || {};
    return { item_selection: iatrS(r.item_selection), quantity_uom: iatrS(r.quantity_uom), requested_qty: r.requested_qty, source_ia_line_id: iatrS(r.source_ia_line_id),
      source_ref_key: iatrS(src.sc_ref_key), item_name: iatrS(src.item_name) };
  }), c);
  return base.map((row, i) => {
    const r = list[i];
    const own = iatrParse((byId[iatrId(r.source_ia_line_id)] || {}).temp_qty_data).filter((p) => p && typeof p === "object");
    const picks = (Array.isArray(r.picks) ? r.picks : []).map((p) => {
      const m = own.filter((o) => iatrId(o.location_id) === iatrId(p.location_id) && iatrS(o.batch_id) === iatrS(p.batch_id))[0] || {};
      return { material_id: iatrS(r.item_selection), location_id: iatrId(p.location_id), storage_location_id: m.storage_location_id || null, batch_id: iatrS(p.batch_id) || null,
        balance_id: iatrS(m.balance_id), sm_quantity: iatrQ8(p.sm_quantity), category: "Unrestricted", plant_id: iatrId(c.plant), organization_id: iatrId(c.org), is_deleted: 0,
        expired_date: m.expired_date || null, manufacturing_date: m.manufacturing_date || null };
    });
    const total = iatrQ8(picks.reduce((t, p) => t + p.sm_quantity, 0));
    return Object.assign(row, { total_quantity: total.toFixed(8), temp_qty_data: picks.length ? JSON.stringify(picks) : "" });
  });
};

// the IA form's stock summary of a line's picks (sc_main.js scAllocate)
const iatrSummary = function iatrSummary(picks, uom, binName, batchNo) {
  const list = (Array.isArray(picks) ? picks : []).filter((p) => p && typeof p === "object");
  if (!list.length) return "";
  const q = (v) => iatrQ8(v);
  const total = q(list.reduce((t, p) => t + q(p.sm_quantity), 0));
  return "Total: " + total + " " + uom + "\n\nDETAILS:\n" + list.map((p, i) => (i + 1) + ". " + (binName[iatrS(p.location_id)] || iatrS(p.location_id)) + ": " + q(p.sm_quantity) + " "
    + uom + " (UNR)" + (iatrS(p.batch_id) ? "\n[" + (batchNo[iatrS(p.batch_id)] || iatrS(p.batch_id)) + "]" : "")).join("\n");
};

// DEFECT's input: JSON text { <IA line id>: { qty, reason } | { batches: { <batch id>: qty }, reason } } -> { ok, defects } or { ok: false, message }
const iatrDefectsOf = function iatrDefectsOf(text) {
  const bad = (why) => ({ ok: false, message: "defects: " + why });
  let v = null;
  try {
    v = text && typeof text === "object" ? text : JSON.parse(iatrS(text) || "null");
  } catch (e) {
    v = null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return bad("an object of the Item Assembly's line ids");
  const digits = (x) => /^[0-9]{1,20}$/.test(iatrS(x));
  const qty = (x) => iatrS(x) !== "" && isFinite(Number(x)) && Number(x) >= 0;
  const out = {};
  for (const id of Object.keys(v)) {
    const d = v[id];
    if (!digits(id) || !d || typeof d !== "object" || Array.isArray(d)) return bad("line ids (digits) to { qty, reason } or { batches, reason }");
    const o = { reason: iatrS(d.reason) };
    if (o.reason.length > 255) return bad("a reason of at most 255 characters");
    if (d.batches !== undefined) {
      if (!d.batches || typeof d.batches !== "object" || Array.isArray(d.batches)) return bad("batches: batch ids (digits) to quantities");
      o.batches = {};
      for (const b of Object.keys(d.batches)) {
        if (!digits(b) || !qty(d.batches[b])) return bad("batches: batch ids (digits) to quantities of 0 or more");
        o.batches[b] = String(iatrQ8(d.batches[b]));
      }
    } else {
      if (!qty(d.qty)) return bad("qty: a quantity of 0 or more");
      o.qty = String(iatrQ8(d.qty));
    }
    out[id] = o;
  }
  if (!Object.keys(out).length) return bad("at least one line");
  return { ok: true, defects: out };
};

// what an operation may do, from the reads (before any write). inp: iatrDecide's (op, ia, iaLines, items, uoms, reqs, named, sl, bin,
// member, org, iaId, rule, expectFp, storage, binId, requiredDate) + holds (the IA's Allocated RES-01 rows), setupRows (its Item
// Assembly Setup rows), defects (iatrDefectsOf's), now, logEntry (the log entry's who: by, uid, claim), and for the stock summary
// uomNames / binNames / batchNos ->
// { route: ANSWER (code, message, result) | GO (+ the write's values) }
const iatrDecide2 = function iatrDecide2(inp) {
  const x = inp || {};
  const op = iatrS(x.op);
  const ia = x.ia && typeof x.ia === "object" && iatrS(x.ia.id) ? x.ia : null;
  const answer = (code, message, result) => ({ route: "ANSWER", code: String(code), message: message, result: result || {} });
  const reqs = iatrRequests(x.reqs);
  const view = (r) => (r ? { id: iatrS(r.id), no: iatrS(r.no), status: iatrS(r.status), rev: Number(r.rev) || 0 } : null);
  if (IATR_OPS2.indexOf(op) < 0) return answer(400, "operation must be CREATE, REFRESH, REPLACE, DEFECT, CANCEL or STATUS");
  if (!(Number(x.member) > 0)) return answer(400, "You are not assigned to this Item Assembly's organisation.");
  const named = x.named && typeof x.named === "object" ? x.named : null;
  const ours = (n) => n && iatrS(n.id) && iatrS(n.purpose) === IATR_PURPOSE && iatrId(n.source) === iatrId(ia ? ia.id : x.iaId);
  const cancel = (n) => {
    if (iatrS(n.status) === "Cancelled") return answer(200, "Transfer request " + iatrS(n.no) + " is already cancelled.", { request: view(n), already: "YES" });
    if (iatrS(n.status) !== "Requested") {
      return answer(400, "Only a Requested transfer request can be cancelled here (" + iatrS(n.no) + " is " + iatrS(n.status) + "): a dispatched one is cancelled from the Location Transfer list.");
    }
    if (Number(n.openJobs) > 0 || Number(n.openTransit) > 0) return answer(409, "Transfer request " + iatrS(n.no) + " is being dispatched: wait for it to finish.");
    // the IA's link (its list's Transfer Request column: the latest open or received request) goes back to its newest received request
    const back = ia && reqs.received && iatrS(reqs.received.id) !== iatrS(n.id) ? reqs.received : null;
    return { route: "GO", code: "200", message: "", result: {}, lotId: iatrS(n.id), lotNo: iatrS(n.no),
      relink: back ? { id: iatrS(ia.id), transfer_request_id: iatrS(back.id), transfer_request_no: iatrS(back.no) } : null };
  };
  if (!ia) {
    // the IA was deleted with its request live (10-29): that request can still be cancelled, by a user of its own organisation
    if (op !== "CANCEL" || !named) return answer(400, "Item Assembly not found - it may have been deleted.");
    if (!ours(named) || !iatrS(x.iaId)) return answer(400, "This transfer request does not belong to this Item Assembly.");
    if (!iatrS(named.org) || iatrId(named.org) !== iatrId(x.org)) return answer(400, "You are not assigned to this transfer request's organisation.");
    return cancel(named);
  }
  if (iatrId(ia.org) !== iatrId(x.org)) return answer(400, "You are not assigned to this Item Assembly's organisation.");
  const items = {};
  for (const it of Array.isArray(x.items) ? x.items : []) if (it && iatrS(it.id)) items[iatrId(it.id)] = it;
  const holds = Array.isArray(x.holds) ? x.holds : [];
  const setupOn = rrSetupOn(x.setupRows, ia.org);
  const received = reqs.received;
  const staging = received ? { storage: iatrId(received.sl), bin: iatrId(received.bin) } : null;
  const fromHolds = (bin) => {
    const r = rrLinesFromHolds(x.iaLines, holds, items, bin);
    return { lines: r.lines, skipped: r.skipped.filter((k) => k.reason !== "not stock-controlled") };
  };
  const lineCtx = (dest) => ({ iaLines: x.iaLines, items: items, uoms: x.uoms, storage: dest.storage, bin: dest.bin, plant: ia.plant, org: ia.org });
  const status = iatrS(ia.status);
  if (op === "STATUS") {
    const r = reqs.live || received || reqs.latest;
    const stale = r && iatrS(r.status) === "Requested" && status === "Created" ? (rrReqFp(fromHolds(iatrId(r.bin)).lines) !== iatrS(r.fp) ? "YES" : "NO") : "NO";
    return answer(200, "", { request: r ? Object.assign(view(r), { stale: stale, sl: iatrS(r.sl), bin: iatrS(r.bin) }) : null, history: reqs.all.map(view),
      setup_on: setupOn ? "YES" : "NO", can_create: setupOn && status === "Created" && !reqs.live && !received ? "YES" : "NO",
      can_replace: status === "Created" && received && !reqs.live ? "YES" : "NO", staging: staging ? { sl: staging.storage, bin: staging.bin } : null,
      gap: received && !reqs.live ? rrGap(x.iaLines, holds, [], items) : [],
      // the replacement's new reservation is in place (a Created save after its allocation): REPLACE can send it
      replace_ready: status === "Created" && received && !reqs.live && fromHolds(staging.bin).lines.length > 0 ? "YES" : "NO" });
  }
  if (op === "CANCEL") {
    if (!ours(named)) return answer(400, "This transfer request does not belong to this Item Assembly.");
    return cancel(named);
  }
  // CREATE / REFRESH / REPLACE / DEFECT: a Created IA, whose components RES-01 reserved (a Draft reserves nothing)
  if (status !== "Created") {
    return answer(400, "Only a Created Item Assembly can use transfer requests: save it as Created first, which reserves its materials (this one is " + (status || "without a status") + ").");
  }
  if (op !== "DEFECT" && iatrS(x.expectFp) !== iatrIaFp(iatrBasis(ia), x.iaLines)) {
    return answer(409, "This Item Assembly has unsaved changes, or someone else saved it: save it (or open it again), then try again.");
  }
  if (op === "DEFECT") {
    if (!received) return answer(400, "Report a defect after a transfer request is received: nothing of this Item Assembly is reserved at a staging bin yet.");
    const d = rrDefectPlan(x.iaLines, holds, staging.bin, x.defects);
    if (!d.ok) return answer(400, d.message, { code: d.code });
    if (!d.moves.length) return answer(400, "Enter the defective quantity of at least one line.");
    const map = (rows, k, v) => {
      const o = {};
      for (const r of Array.isArray(rows) ? rows : []) if (r && iatrS(r.id)) o[iatrS(r.id)] = iatrS(r[v]);
      return o;
    };
    const uomName = map(x.uomNames, "id", "uom_name");
    const binName = map(x.binNames, "id", "name");
    const batchNo = map(x.batchNos, "id", "batch_number");
    const byLine = {};
    for (const l of Array.isArray(x.iaLines) ? x.iaLines : []) if (l && iatrS(l.id)) byLine[iatrS(l.id)] = l;
    const movements = [];
    d.moves.forEach((m, i) => {
      const k = "D" + (i + 1);
      const base = { material_id: iatrS(m.material_id), location_id: iatrS(m.location_id), batch_id: iatrS(m.batch_id) || null, plant_id: iatrS(ia.plant), organization_id: iatrS(ia.org),
        quantity: iatrQ8(m.quantity), material_uom: iatrS(m.uom) || null, isMovingInv: 1, transaction_type: "IA-D", trx_no: iatrS(ia.no) + "/D", parent_trx_no: "",
        doc_date: iatrS(x.now) || null };
      movements.push(Object.assign({ movement_key: k, direction: "SUBTRACT", inventory_category: "Reserved" }, base));
      movements.push(Object.assign({ movement_key: k + ".2", direction: "ADD", inventory_category: "Blocked" }, base, { unit_price_from: k }));
    });
    const iaRows = Object.keys(d.iaPicks).map((id) => {
      const picks = d.iaPicks[id].map((p) => Object.assign({}, p, { sm_quantity: iatrQ8(p.sm_quantity) }));
      return { id: id, temp_qty_data: picks.length ? JSON.stringify(picks) : "", total_quantity: iatrQ8(picks.reduce((t, p) => t + p.sm_quantity, 0)).toFixed(8),
        stock_summary: iatrSummary(picks, uomName[iatrS((byLine[id] || {}).quantity_uom)] || "", binName, batchNo) };
    });
    const entry = Object.assign({ at: iatrS(x.now) }, x.logEntry || {}, { op: "DEFECT", defects: x.defects });
    return { route: "GO", code: "200", message: "", result: {}, lotId: iatrS(received.id), lotNo: iatrS(received.no), defect: d, movements: movements, iaRows: iaRows,
      holdRows: d.holdChanges, logRow: { id: iatrS(received.id), request_log: iatrLog(received.log, entry) } };
  }
  if (op === "REFRESH") {
    if (!ours(named)) return answer(400, "This transfer request does not belong to this Item Assembly.");
    if (iatrS(named.status) !== "Requested") return answer(400, "Only a Requested transfer request can be refreshed (" + iatrS(named.no) + " is " + iatrS(named.status) + ").");
    if (Number(named.openJobs) > 0 || Number(named.openTransit) > 0) return answer(409, "Transfer request " + iatrS(named.no) + " is being dispatched: wait for it to finish.");
    const dest = { storage: iatrId(named.sl), bin: iatrId(named.bin) };
    const now = fromHolds(dest.bin);
    if (!now.lines.length) return answer(400, "Nothing of this Item Assembly is reserved now: reserve its materials again, or cancel the request.");
    const fp = rrReqFp(now.lines);
    if (fp === iatrS(named.fp)) return answer(200, "Transfer request " + iatrS(named.no) + " already matches this Item Assembly's reservation.", { request: view(named), already: "YES" });
    return { route: "GO", code: "200", message: "", result: {}, lotId: iatrS(named.id), lotNo: iatrS(named.no), fp: fp, rev: (Number(named.rev) || 0) + 1, lines: now.lines.length,
      lineRows: rrLotLines(now.lines, lineCtx(dest)), skipped: now.skipped };
  }
  // CREATE / REPLACE: one open request per IA; CREATE needs the setup on (D12), never after a receipt; REPLACE follows a receipt (D6),
  // to its staging bin; a destination in this plant; a number rule
  if (reqs.live) return answer(200, "This Item Assembly already has transfer request " + iatrS(reqs.live.no) + " (" + iatrS(reqs.live.status) + ").",
    { request: view(reqs.live), existing: "YES" });
  if (op === "CREATE") {
    if (!setupOn) return answer(400, "Transfer requests are turned off in Item Assembly Setup.");
    if (received) {
      return answer(409, "Transfer request " + iatrS(received.no) + " was already received for this Item Assembly: request what is missing with Replace.", { request: view(received) });
    }
  } else {
    if (!received) return answer(400, "A replacement follows a received transfer request: this Item Assembly has none yet.");
    if (iatrId(x.storage) !== staging.storage || iatrId(x.binId) !== staging.bin) {
      return answer(400, "A replacement goes to the staging bin of " + iatrS(received.no) + ", where this Item Assembly takes its materials.");
    }
  }
  const sl = x.sl && typeof x.sl === "object" ? x.sl : null;
  const bin = x.bin && typeof x.bin === "object" ? x.bin : null;
  if (!sl || iatrId(sl.id) !== iatrId(x.storage) || iatrId(sl.plant) !== iatrId(ia.plant) || Number(sl.active) !== 1) {
    return answer(400, "Choose an active storage location of this Item Assembly's plant.");
  }
  if (!bin || iatrId(bin.id) !== iatrId(x.binId) || iatrId(bin.plant) !== iatrId(ia.plant) || iatrId(bin.sl) !== iatrId(sl.id) || Number(bin.active) !== 1) {
    return answer(400, "Choose an active bin of storage location " + (iatrS(sl.name) || iatrS(sl.id)) + ".");
  }
  if (!iatrDate(x.requiredDate)) return answer(400, "Enter the date the materials are required.");
  if (!iatrS(x.rule)) return answer(400, "No Location Transfer number rule is set up for this organisation.");
  const now = fromHolds(iatrId(bin.id));
  if (!now.lines.length) {
    return answer(400, op === "CREATE" ? "Nothing of this Item Assembly is reserved: save it as Created with its materials allocated, then request them."
      : "Nothing new is reserved for this Item Assembly: allocate the missing quantity and save it as Created, then request it.");
  }
  // the cancelled request this one replaces: the newest cancelled, and for a replacement only one cancelled after the receipt
  const c = reqs.cancelled;
  const replacesId = c && (op === "CREATE" || iatrNewest(c, received) < 0) ? iatrS(c.id) : "";
  return { route: "GO", code: "200", message: "", result: {}, fp: rrReqFp(now.lines), rev: 1, lines: now.lines.length, replacesId: replacesId,
    replacementForId: op === "REPLACE" ? iatrS(received.id) : "", lineRows: rrLotLines(now.lines, lineCtx({ storage: iatrId(sl.id), bin: iatrId(bin.id) })), skipped: now.skipped };
};

// after our claim (iatrWin's rule): the lowest live HELD claim of the IA wins, and the decision's facts still hold - the IA Created
// (CREATE / REFRESH / REPLACE / DEFECT), no open request appeared (CREATE / REPLACE) nor a receipt (CREATE), the receipt still there
// (REPLACE / DEFECT), the named request still Requested with no open job (REFRESH / CANCEL). -> { route: WIN | LOSE, claimId, message }
const iatrWin2 = function iatrWin2(op, ourName, st, lotId) {
  const s0 = st || {};
  const now = Date.parse(iatrS(s0.now).replace(" ", "T") + "Z");
  const claims = (Array.isArray(s0.claims) ? s0.claims : []).filter((c) => c && /^CLAIM\|[0-9]+$/.test(iatrS(c.name)));
  const live = claims.filter((c) => now - Date.parse(iatrS(c.started_at).replace(" ", "T") + "Z") < IATR_LEASE_MS);
  const me = claims.filter((c) => iatrS(c.name) === iatrS(ourName))[0];
  const first = live.slice().sort((a, b) => Number(iatrS(a.name).slice(6)) - Number(iatrS(b.name).slice(6)))[0];
  const lose = (message) => ({ route: "LOSE", claimId: me ? iatrS(me.id) : "", message: message });
  if (!me || !first || iatrS(first.name) !== iatrS(me.name)) return lose("This Item Assembly's transfer request is being changed in another window: refresh it to see the result.");
  if (op !== "CANCEL" && iatrS(s0.status) !== "Created") return lose("This Item Assembly changed meanwhile (it is " + (iatrS(s0.status) || "gone") + " now): refresh it.");
  const reqs = iatrRequests(s0.reqs);
  if ((op === "CREATE" || op === "REPLACE") && reqs.live) return lose("A transfer request was made for this Item Assembly meanwhile: refresh it.");
  if (op === "CREATE" && reqs.received) return lose("A transfer request of this Item Assembly was received meanwhile: refresh it.");
  if ((op === "REPLACE" || op === "DEFECT") && !reqs.received) return lose("This Item Assembly's received transfer request changed meanwhile: refresh it.");
  if (op === "REFRESH" || op === "CANCEL") {
    const n = reqs.all.filter((r) => iatrS(r.id) === iatrS(lotId))[0];
    if (!n || iatrS(n.status) !== "Requested" || Number(s0.openJobs) > 0) return lose("The transfer request changed meanwhile (it is " + (n ? iatrS(n.status) : "gone") + " now): refresh it.");
  }
  return { route: "WIN", claimId: iatrS(me.id), message: "" };
};

if (typeof module !== "undefined") module.exports = { IATR_OPS2, rrReqFp, rrLotLines, iatrSummary, iatrDefectsOf, iatrDecide2, iatrWin2 };
