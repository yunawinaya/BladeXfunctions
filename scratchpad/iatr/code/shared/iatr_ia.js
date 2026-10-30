// IA -> Location Transfer Request (ENH-20261027-001): the Item Assembly side - IA_TRANSFER_REQUEST's decisions and the IA form's
// fingerprint. Needs code/shared/iatr_rules.js before it.
const IATR_LIVE = ["Requested", "In Progress", "Processing"];
// material hold statuses that leave nothing reserved (RES-01: RESERVING / SHORT / PARTIAL / FULL hold stock)
const IATR_HOLDS_OK = ["", "NONE", "CLOSED"];
const IATR_OPS = ["CREATE", "REFRESH", "CANCEL", "STATUS"];

// IA1: the Item Assembly as a screen shows it - every line (id, item, unit, BOM reference, Required) and its header basis. The
// form sends it with a create / refresh; a different stored IA means unsaved edits or a stale tab
const iatrIaFp = function iatrIaFp(head, lines) {
  const h = head || {};
  const opt = (v) => (iatrBlank(v) ? "" : iatrQ8(v).toFixed(8));
  const rows = (Array.isArray(lines) ? lines : []).filter((l) => l && typeof l === "object").map((l) => [iatrId(l.id), iatrId(l.item_selection), iatrId(l.quantity_uom),
    iatrQ8(l.requested_qty).toFixed(8), opt(l.required_qty)]);
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const basis = [iatrId(h.plant), iatrId(h.itemId), opt(h.itemQty), opt(h.plannedQty), iatrS(h.mode), iatrId(h.bomId)];
  return "IA1:" + rows.length + ":" + iatrHash(JSON.stringify([basis, rows]));
};
// the header basis of both fingerprints, from a stored IA row (the request read's names)
const iatrBasis = (ia) => {
  const h = ia || {};
  return { plant: h.plant, itemId: h.item_id, itemQty: h.item_qty, plannedQty: h.planned_output_qty, mode: h.bom_consumption_mode, bomId: h.source_bom_id };
};
// snowflake ids as text, newest first
const iatrNewest = (a, b) => {
  const x = iatrS(a && a.id);
  const y = iatrS(b && b.id);
  return x.length !== y.length ? y.length - x.length : x < y ? 1 : x > y ? -1 : 0;
};
// an IA's requests: the live one (Requested / In Progress / Processing), the received one, the latest cancelled one, the newest
const iatrRequests = function iatrRequests(rows) {
  const all = (Array.isArray(rows) ? rows : []).filter((r) => r && iatrS(r.id)).slice().sort(iatrNewest);
  const first = (f) => all.filter(f)[0] || null;
  return { all: all, live: first((r) => IATR_LIVE.indexOf(iatrS(r.status)) >= 0), received: first((r) => iatrS(r.status) === "Completed"),
    cancelled: first((r) => iatrS(r.status) === "Cancelled"), latest: all[0] || null };
};
// the request's lines from the demand (spec section 6: Requested Qty = the requirement, nothing picked, the destination on every line,
// the item's units as the LOT form builds them); ctx: { iaLines, items, uoms (item id -> unit rows), storage, bin, plant, org }
const iatrLotLines = function iatrLotLines(demand, ctx) {
  const c = ctx || {};
  const byId = {};
  for (const l of Array.isArray(c.iaLines) ? c.iaLines : []) if (l && iatrS(l.id)) byId[iatrId(l.id)] = l;
  return (Array.isArray(demand) ? demand : []).map((d, i) => {
    const it = (c.items || {})[d.item_selection] || {};
    const src = byId[iatrId(d.source_ia_line_id)] || {};
    return { item_selection: d.item_selection, item_name: iatrS(src.item_name) || iatrS(it.material_name) || iatrS(d.item_name), item_desc: iatrS(it.material_desc),
      quantity_uom: d.quantity_uom, requested_qty: iatrQ8(d.requested_qty).toFixed(8), total_quantity: "0.00000000", storage_location_id: iatrId(c.storage),
      location_id: iatrId(c.bin), temp_qty_data: "", temp_hu_data: "[]", temp_excess_data: "", balance_id: "", stock_summary: "", organization_id: iatrId(c.org),
      line_index: String(i + 1), uom_options: (c.uoms || {})[d.item_selection] || [], issuing_plant: iatrId(c.plant), is_serialized_item: 0, item_remark: "",
      item_remark2: "", item_remark3: "", source_ia_line_id: d.source_ia_line_id, source_ref_key: iatrS(d.source_ref_key) };
  });
};
// the request's audit log (spec IA-LT-03 / IA-LT-11): JSON text in, one entry appended, JSON text out (an unreadable log is kept as text)
const iatrLog = function iatrLog(text, entry) {
  const t = iatrS(text);
  let log = [];
  if (t) {
    try {
      const v = JSON.parse(t);
      log = Array.isArray(v) ? v : [{ op: "UNREADABLE", text: t.slice(0, 2000) }];
    } catch (e) {
      log = [{ op: "UNREADABLE", text: t.slice(0, 2000) }];
    }
  }
  return JSON.stringify(log.concat([entry]));
};
// a real calendar day as YYYY-MM-DD (2026-02-30 is not: the date column refuses it)
const iatrDate = (v) => {
  const t = iatrS(v);
  const ms = Date.parse(t + "T00:00:00Z");
  return !isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === t;
};

// what an operation may do, from the reads (before any write). inp: { op, ia (header), iaLines, items, uoms, reqs (the IA's requests:
// { id, no, status, rev, fp, sl, bin }), named (the request REFRESH / CANCEL names: those + purpose, source, log, lines, openJobs,
// openTransit, org), bin, sl, member, org (the organisation the member read was for), iaId (the IA asked about), rule, expectFp, storage, binId,
// requiredDate }. ->
// { route: ANSWER (code, message, result) | GO (+ the write's values) }
const iatrDecide = function iatrDecide(inp) {
  const x = inp || {};
  const op = iatrS(x.op);
  const ia = x.ia && typeof x.ia === "object" ? x.ia : null;
  const answer = (code, message, result) => ({ route: "ANSWER", code: String(code), message: message, result: result || {} });
  const reqs = iatrRequests(x.reqs);
  const view = (r) => (r ? { id: iatrS(r.id), no: iatrS(r.no), status: iatrS(r.status), rev: Number(r.rev) || 0 } : null);
  if (IATR_OPS.indexOf(op) < 0) return answer(400, "operation must be CREATE, REFRESH, CANCEL or STATUS");
  if (!(Number(x.member) > 0)) return answer(400, "You are not assigned to this Item Assembly's organisation.");
  // CANCEL of the named request (state only): Requested, no dispatch under way
  const cancel = (n) => {
    if (iatrS(n.status) === "Cancelled") return answer(200, "Transfer request " + iatrS(n.no) + " is already cancelled.", { request: view(n), already: "YES" });
    if (iatrS(n.status) !== "Requested") {
      return answer(400, "Only a Requested transfer request can be cancelled here (" + iatrS(n.no) + " is " + iatrS(n.status) + "): a dispatched one is cancelled from the Location Transfer list.");
    }
    if (Number(n.openJobs) > 0 || Number(n.openTransit) > 0) return answer(409, "Transfer request " + iatrS(n.no) + " is being dispatched: wait for it to finish.");
    return { route: "GO", code: "200", message: "", result: {}, lotId: iatrS(n.id), lotNo: iatrS(n.no) };
  };
  if (!ia || !iatrS(ia.id)) {
    // the IA was deleted with its request live (the user, 10-29: the mobile delete does not ask): that request can still be cancelled,
    // by a user of the request's own organisation; nothing else works without the IA
    const n = x.named && typeof x.named === "object" ? x.named : null;
    if (op !== "CANCEL" || !n) return answer(400, "Item Assembly not found - it may have been deleted.");
    if (!iatrS(n.id) || iatrS(n.purpose) !== IATR_PURPOSE || !iatrS(x.iaId) || iatrId(n.source) !== iatrId(x.iaId)) return answer(400, "This transfer request does not belong to this Item Assembly.");
    if (!iatrS(n.org) || iatrId(n.org) !== iatrId(x.org)) return answer(400, "You are not assigned to this transfer request's organisation.");
    return cancel(n);
  }
  // the member read is for the organisation the client named: it must be the IA's own (spec IA-LT-09)
  if (iatrId(ia.org) !== iatrId(x.org)) return answer(400, "You are not assigned to this Item Assembly's organisation.");
  const items = {};
  for (const it of Array.isArray(x.items) ? x.items : []) if (it && iatrS(it.id)) items[iatrId(it.id)] = it;
  const demandNow = () => iatrDemand(x.iaLines, items);
  // a request's destination: its lines' storage / bin (the request read gives its first line's)
  const destOf = (r) => ({ storage: iatrId(r && r.sl), bin: iatrId(r && r.bin) });
  const fpWith = (demand, dest) => iatrFingerprint(demand.lines, Object.assign(iatrBasis(ia), { storage: dest.storage, bin: dest.bin }));
  if (op === "STATUS") {
    const r = reqs.live || reqs.received || reqs.latest;
    const d = demandNow();
    const stale = r && iatrS(r.status) === "Requested" ? (!d.ok || fpWith(d, destOf(r)) !== iatrS(r.fp) ? "YES" : "NO") : "NO";
    // its staging storage location and bin too: a received request's IA picks its components there (the user, 10-29)
    return answer(200, "", { request: r ? Object.assign(view(r), { stale: stale, sl: iatrS(r.sl), bin: iatrS(r.bin) }) : null, history: reqs.all.map(view),
      can_create: reqs.live || reqs.received ? "NO" : "YES" });
  }
  if (op === "CANCEL") {
    const n = x.named && typeof x.named === "object" ? x.named : null;
    if (!n || !iatrS(n.id) || iatrS(n.purpose) !== IATR_PURPOSE || iatrId(n.source) !== iatrId(ia.id)) return answer(400, "This transfer request does not belong to this Item Assembly.");
    return cancel(n);
  }
  // CREATE / REFRESH: a saved Draft IA, nothing held, a positive output, the screen's IA is the stored one, a valid demand
  const status = iatrS(ia.status);
  if (status !== "Draft") return answer(400, "Only a saved Draft Item Assembly can request its materials (this one is " + (status || "without a status") + ").");
  if (IATR_HOLDS_OK.indexOf(iatrS(ia.hold).toUpperCase()) < 0) return answer(400, "This Item Assembly holds materials (" + iatrS(ia.hold) + "): release them first.");
  if (!(iatrQ8(ia.item_qty) > 0)) return answer(400, "Enter the Item Assembly's output quantity and save it, then request its materials.");
  if (iatrS(x.expectFp) !== iatrIaFp(iatrBasis(ia), x.iaLines)) {
    return answer(409, "This Item Assembly has unsaved changes, or someone else saved it: save it (or open it again), then request its materials.");
  }
  const d = demandNow();
  if (!d.ok) return answer(400, d.message);
  if (op === "REFRESH") {
    const n = x.named && typeof x.named === "object" ? x.named : null;
    if (!n || !iatrS(n.id) || iatrS(n.purpose) !== IATR_PURPOSE || iatrId(n.source) !== iatrId(ia.id)) return answer(400, "This transfer request does not belong to this Item Assembly.");
    if (iatrS(n.status) !== "Requested") return answer(400, "Only a Requested transfer request can be refreshed (" + iatrS(n.no) + " is " + iatrS(n.status) + ").");
    if (Number(n.openJobs) > 0 || Number(n.openTransit) > 0) return answer(409, "Transfer request " + iatrS(n.no) + " is being dispatched: wait for it to finish.");
    const dest = destOf(n);
    const fp = fpWith(d, dest);
    const same = iatrDispatchCheck(n.lines, n.lines, { iaStatus: "Draft", iaFp: fp, lotFp: iatrS(n.fp), demand: d.lines });
    if (same.ok || same.code === "IATR_NOT_FULL" || same.code.indexOf("IATR_PICK") === 0) {
      return answer(200, "Transfer request " + iatrS(n.no) + " already matches this Item Assembly.", { request: view(n), already: "YES" });
    }
    return { route: "GO", code: "200", message: "", result: {}, lotId: iatrS(n.id), lotNo: iatrS(n.no), fp: fp, rev: (Number(n.rev) || 0) + 1, lines: d.lines.length,
      lineRows: iatrLotLines(d.lines, { iaLines: x.iaLines, items: items, uoms: x.uoms, storage: dest.storage, bin: dest.bin, plant: ia.plant, org: ia.org }) };
  }
  // CREATE: one live request per IA, never after one was received (spec IA-LT-10); a destination in this plant; a number rule
  if (reqs.live) return answer(200, "This Item Assembly already has transfer request " + iatrS(reqs.live.no) + " (" + iatrS(reqs.live.status) + ").",
    { request: view(reqs.live), existing: "YES" });
  if (reqs.received) {
    return answer(409, "Transfer request " + iatrS(reqs.received.no) + " was already received for this Item Assembly: a second full request can't be made from it.",
      { request: view(reqs.received) });
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
  const fp = fpWith(d, { storage: iatrId(sl.id), bin: iatrId(bin.id) });
  return { route: "GO", code: "200", message: "", result: {}, fp: fp, rev: 1, lines: d.lines.length, replacesId: reqs.cancelled ? iatrS(reqs.cancelled.id) : "",
    lineRows: iatrLotLines(d.lines, { iaLines: x.iaLines, items: items, uoms: x.uoms, storage: sl.id, bin: bin.id, plant: ia.plant, org: ia.org }) };
};

// after our claim (IA_SAVE MIN-02's rule): the lowest live HELD claim of the IA wins (a claim older than the lease is a dead run), and
// what the decision read must still hold - the IA (CREATE / REFRESH: Draft), no live or received request appeared (CREATE), the named
// request still Requested with no open job (REFRESH / CANCEL). -> { route: WIN | LOSE, message }
const IATR_LEASE_MS = 10 * 60 * 1000;
const iatrWin = function iatrWin(op, ourName, st, lotId) {
  const s0 = st || {};
  const now = Date.parse(iatrS(s0.now).replace(" ", "T") + "Z");
  const claims = (Array.isArray(s0.claims) ? s0.claims : []).filter((c) => c && /^CLAIM\|[0-9]+$/.test(iatrS(c.name)));
  const live = claims.filter((c) => now - Date.parse(iatrS(c.started_at).replace(" ", "T") + "Z") < IATR_LEASE_MS);
  const me = claims.filter((c) => iatrS(c.name) === iatrS(ourName))[0];
  const first = live.slice().sort((a, b) => Number(iatrS(a.name).slice(6)) - Number(iatrS(b.name).slice(6)))[0];
  const lose = (message) => ({ route: "LOSE", claimId: me ? iatrS(me.id) : "", message: message });
  if (!me || !first || iatrS(first.name) !== iatrS(me.name)) return lose("This Item Assembly's transfer request is being changed in another window: refresh it to see the result.");
  if (op !== "CANCEL" && iatrS(s0.status) !== "Draft") return lose("This Item Assembly changed meanwhile (it is " + (iatrS(s0.status) || "gone") + " now): refresh it.");
  const reqs = iatrRequests(s0.reqs);
  if (op === "CREATE" && (reqs.live || reqs.received)) return lose("A transfer request was made for this Item Assembly meanwhile: refresh it.");
  if (op !== "CREATE") {
    const n = reqs.all.filter((r) => iatrS(r.id) === iatrS(lotId))[0];
    if (!n || iatrS(n.status) !== "Requested" || Number(s0.openJobs) > 0) return lose("The transfer request changed meanwhile (it is " + (n ? iatrS(n.status) : "gone") + " now): refresh it.");
  }
  return { route: "WIN", claimId: iatrS(me.id), message: "" };
};

if (typeof module !== "undefined") module.exports = { IATR_LIVE, IATR_HOLDS_OK, IATR_OPS, iatrIaFp, iatrBasis, iatrNewest, iatrRequests, iatrLotLines, iatrLog, iatrDate, iatrDecide, iatrWin, IATR_LEASE_MS };
