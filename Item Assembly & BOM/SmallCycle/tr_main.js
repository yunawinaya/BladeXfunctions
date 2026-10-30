// tr_main - Item Assembly form, transfer requests from a reserved IA (ENH-20261027-001; scratchpad/iatr/RESERVED_REQUEST_PLAN.md Task 9):
// the Transfer Request section.
//   MOUNT    a saved IA: STATUS when it links a request, or when it is Created and its organisation's Item Assembly Setup has Transfer
//            Request on (read here first: an IA of an organisation with it off opens with no extra call); a Draft without one: nothing (a
//            Draft reserves nothing). The section: Request Materials (setup on, nothing open or received; ia_create_transfer_request);
//            Requested: its line, View, Refresh, Cancel; in transit: a read-only notice (the IA can't change until it is received) and
//            View (Receive is on its form); received: its line, View, Request Replacement (something missing, or the replacement's
//            reservation ready) and Report Defect (lot_ia_receive); more than one request: the list of them on its line. Received with
//            something missing and not yet offered in this browser (a Receive from the Location Transfer list): the replacement offered
//   NEW / CREATE / REFRESH / CANCEL   IA_TRANSFER_REQUEST; the IA as this screen shows it goes along (IA1), so unsaved edits are refused
//   VIEW     the request in its own form (a dispatched one in edit mode: Receive is there)
//   STORAGE  the staging bin follows its storage location
//   RELOAD   the request's form closed after a save from VIEW: the section from STATUS; a request just received with something missing
//            offers the replacement (D6; once per receipt and browser; declined, the button stays)
//   REPLACE  something missing: sc_main GAP allocates it away from the staging bin (the staging picks stay), then the user saves the IA as
//            Created (RES-01 reserves it); the reservation ready: REPLACE sends it as the replacement request
//   DEFECT_OPEN / DEFECT / DEFECT_CLOSE   Report Defect (D2): the dialog of the IA's picks at the staging bin, per batch; DEFECT with the
//            quantities and one reason per line
// Nothing here writes the IA: IA_TRANSFER_REQUEST and the IA's own saves do.
const TR_ENABLED = true;
const IATR_WF = "1985966508400201729"; // IA_TRANSFER_REQUEST
const LOT_FORM = "2013791389687349250";
// IA -> Location Transfer Request (ENH-20261027-001): the shared rules. Pure; used by IA_TRANSFER_REQUEST, the LOT V2 SUBMIT gate
// and (iatrTransition only) the classic LOT guard. A request LOT has transfer_purpose IATR_PURPOSE and starts as status Requested.
const IATR_PURPOSE = "IA_SUPPLY";
const iatrS = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const iatrQ8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
// JSON text whose 16+ digit numbers are kept as text (a 19-digit id read as a number loses digits)
const iatrParse = function iatrParse(t) {
  if (Array.isArray(t)) return t;
  if (t && typeof t === "object") return [t];
  try {
    const v = JSON.parse(String(t || "").replace(/"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))/g, (m, pre, num) => (num === undefined ? m : pre + '"' + num + '"')));
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
};
// an id as text; a number past 2^53 is marked, never silently equal
const iatrId = (v) => {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? String(v) : "?" + String(v);
  return iatrS(v);
};
const iatrHash = function iatrHash(text) {
  let h1 = 2166136261;
  let h2 = 5381;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = (Math.imul(h2, 33) + c) >>> 0;
  }
  const hex = (x) => ("00000000" + x.toString(16)).slice(-8);
  return hex(h1) + hex(h2);
};
const iatrBlank = (v) => v === undefined || v === null || iatrS(v) === "";

// the demand of a saved IA (spec IA-LT-07): per stock line, the explicit Required quantity when set (an explicit 0 = not asked
// for), else the BOM reference (requested_qty) when above 0; a line with neither stops, named. Non-stock lines are skipped,
// repeated items stay separate lines, the picked quantity is never used. items: id -> Item row
const iatrDemand = function iatrDemand(lines, items) {
  const out = [];
  const list = Array.isArray(lines) ? lines : [];
  const name = (it, id) => iatrS(it && (it.material_name || it.material_code)) || iatrS(id);
  for (const l of list) {
    if (!l || typeof l !== "object") continue;
    const itemId = iatrId(l.item_selection);
    if (!itemId) continue;
    const it = items && items[itemId];
    const label = "line " + (iatrS(l.line_index) || iatrS(l.id)) + " (" + name(it, itemId) + ")";
    if (!it) return { ok: false, message: "The item of " + label + " could not be read. Nothing was created; please try again.", lines: [] };
    if (Number(it.stock_control) === 0) continue;
    if (Number(it.serial_number_management) === 1) {
      return { ok: false, message: label + " is serial-numbered: serial components can't be requested by a transfer request yet. Nothing was created.", lines: [] };
    }
    let qty;
    if (!iatrBlank(l.required_qty)) qty = iatrQ8(l.required_qty);
    else if (iatrQ8(l.requested_qty) > 0) qty = iatrQ8(l.requested_qty);
    else return { ok: false, message: label + " has no required quantity: enter its Required quantity, save the Item Assembly, then create the request.", lines: [] };
    if (qty < 0) return { ok: false, message: label + " has a negative required quantity. Nothing was created.", lines: [] };
    if (qty === 0) continue;
    out.push({ source_ia_line_id: iatrId(l.id), item_selection: itemId, quantity_uom: iatrId(l.quantity_uom), requested_qty: qty, source_ref_key: iatrS(l.sc_ref_key),
      item_name: name(it, itemId) });
  }
  if (!out.length) return { ok: false, message: "This Item Assembly has nothing to request: no stock line with a required quantity.", lines: [] };
  return { ok: true, message: "", lines: out };
};

// IR2 (spec IA-LT-11): the demand a request was made from (line ids, items, units, quantities) + its basis: plant, destination
// storage / bin, the finished item, its output and planned quantities, the BOM mode and BOM (the saved lines carry the BOM
// choices); line order does not matter. basis: { plant, storage, bin, itemId, itemQty, plannedQty, mode, bomId }
const iatrFingerprint = function iatrFingerprint(demandLines, basis) {
  const b = basis || {};
  const qty = (v) => (iatrBlank(v) ? "" : iatrQ8(v).toFixed(8));
  const rows = (Array.isArray(demandLines) ? demandLines : []).map((l) => [iatrId(l.source_ia_line_id), iatrId(l.item_selection), iatrId(l.quantity_uom),
    iatrQ8(l.requested_qty).toFixed(8)]);
  rows.sort((a, b2) => (a[0] < b2[0] ? -1 : a[0] > b2[0] ? 1 : 0));
  const head = [iatrId(b.plant), iatrId(b.storage), iatrId(b.bin), iatrId(b.itemId), qty(b.itemQty), qty(b.plannedQty), iatrS(b.mode), iatrId(b.bomId)];
  return "IR2:" + rows.length + ":" + iatrHash(JSON.stringify([head, rows]));
};

// the dispatch check (spec sections 7 and 10): the stored demand lines unchanged (item, unit, quantity, source line, destination),
// every line picked in full in its own unit (the picks themselves, not total_quantity), Unrestricted loose stock of the line's
// item, never at the destination bin; the IA still Draft and its demand unchanged since the request. Stock availability is the
// engine's. ctx: { iaStatus, iaFp (the IA's demand now), lotFp (the request's), demand (the IA's demand lines now: the stored lines
// must be exactly these; not an array = not compared) }
const iatrDispatchCheck = function iatrDispatchCheck(stored, incoming, ctx) {
  const stop = (code, message) => ({ ok: false, code: code, message: message });
  const c = ctx || {};
  if (iatrS(c.iaStatus) !== "Draft") {
    return stop("IATR_IA_STATUS", "The Item Assembly of this request is " + (iatrS(c.iaStatus) || "no longer there") + ", so the request can't be dispatched.");
  }
  if (iatrS(c.iaFp) !== iatrS(c.lotFp)) {
    return stop("IATR_STALE", "The Item Assembly's materials changed after this request was made: refresh the request from the Item Assembly, then pick again.");
  }
  const st = (Array.isArray(stored) ? stored : []).filter((l) => l && typeof l === "object");
  const inc = (Array.isArray(incoming) ? incoming : []).filter((l) => l && typeof l === "object");
  // the stored lines are the IA's demand now, at one destination (a stale tab's save can write older lines under a newer fingerprint)
  if (Array.isArray(c.demand)) {
    const lines = stop("IATR_LINES_STALE", "This request's lines no longer match its Item Assembly: refresh the request from the Item Assembly, then pick again.");
    if (c.demand.length !== st.length) return lines;
    const want = {};
    for (const d of c.demand) want[iatrId(d.source_ia_line_id)] = d;
    const dest = st.length ? [iatrId(st[0].storage_location_id), iatrId(st[0].location_id)] : [];
    for (const l of st) {
      const d = want[iatrId(l.source_ia_line_id)];
      delete want[iatrId(l.source_ia_line_id)];
      if (!d || iatrId(d.item_selection) !== iatrId(l.item_selection) || iatrId(d.quantity_uom) !== iatrId(l.quantity_uom) || iatrQ8(d.requested_qty) !== iatrQ8(l.requested_qty)
        || iatrId(l.storage_location_id) !== dest[0] || iatrId(l.location_id) !== dest[1]) return lines;
    }
  }
  const changed = stop("IATR_DEMAND_CHANGED", "The requested lines of this transfer were changed. Only the picks can be edited: reopen the transfer and pick again.");
  if (st.length !== inc.length) return changed;
  const byId = {};
  for (const l of st) byId[iatrId(l.id)] = l;
  for (const l of inc) {
    const s = byId[iatrId(l.id)];
    if (!s) return changed;
    const keys = ["item_selection", "quantity_uom", "source_ia_line_id", "storage_location_id", "location_id"];
    if (keys.some((k) => iatrId(l[k]) !== iatrId(s[k])) || iatrQ8(l.requested_qty) !== iatrQ8(s.requested_qty)) return changed;
  }
  for (const l of inc) {
    const want = iatrQ8(l.requested_qty);
    const label = "Line " + (iatrS(l.line_index) || iatrS(l.id)) + (iatrS(l.item_name) ? " (" + iatrS(l.item_name) + ")" : "");
    let sum = 0;
    for (const e of iatrParse(l.temp_qty_data)) {
      if (!e || typeof e !== "object") continue;
      const q = iatrQ8(e.sm_quantity);
      if (q <= 0) continue;
      if (iatrId(e.material_id || l.item_selection) !== iatrId(l.item_selection)) return stop("IATR_PICK_ITEM", label + ": a pick is of another item.");
      if (!iatrBlank(e.material_uom) && iatrId(e.material_uom) !== iatrId(l.quantity_uom)) {
        return stop("IATR_PICK_UOM", label + ": pick it in the line's unit; a pick in another unit can't be dispatched.");
      }
      if (iatrS(e.handling_unit_id) && iatrS(e.handling_unit_id) !== "0") return stop("IATR_PICK_HU", label + ": a pick from a handling unit can't be dispatched; pick loose stock.");
      if ((iatrS(e.category) || "Unrestricted") !== "Unrestricted") {
        return stop("IATR_PICK_CATEGORY", label + ": pick Unrestricted stock; " + iatrS(e.category) + " stock can't supply production.");
      }
      if (iatrId(e.location_id) === iatrId(l.location_id)) return stop("IATR_PICK_AT_DESTINATION", label + ": a pick is from the destination bin itself.");
      sum = iatrQ8(sum + q);
    }
    if (Math.abs(sum - want) > 1e-9) {
      return stop("IATR_NOT_FULL", label + ": picked " + sum + " of " + want + ". Every line must be picked in full before the dispatch.");
    }
  }
  return { ok: true, code: "", message: "" };
};

// the allowed moves of a save (the plan's table). Decided by the STORED row; the payload's purpose / status only refuse a
// claim it does not back. NONE = an ordinary LOT, exactly today's behaviour; SAVE = Save Picks (the classic Draft path, status
// stays Requested); DISPATCH / RECEIVE / CANCEL = LOT V2 only; REFUSE = 400 with message
const iatrTransition = function iatrTransition(a) {
  const x = a || {};
  const stored = iatrS(x.stored);
  const saveAs = iatrS(x.saveAs);
  const purpose = iatrS(x.storedPurpose) === IATR_PURPOSE;
  const refuse = (message) => ({ decision: "REFUSE", message: message });
  const claims = iatrS(x.payloadPurpose) === IATR_PURPOSE || iatrS(x.payloadStatus) === "Requested";
  if (!x.hasStored || !purpose) {
    if (stored === "Requested") return refuse("This transfer is Requested but not an Item Assembly request; it can't be saved. Please contact support.");
    if (claims) return refuse("A transfer request can only be created from an Item Assembly (Create Transfer Request).");
    return { decision: "NONE", message: "" };
  }
  if (stored === "Requested") {
    if (saveAs === "Draft") return { decision: "SAVE", message: "" };
    if (saveAs === "In Progress") return { decision: "DISPATCH", message: "" };
    if (saveAs === "Cancelled") return refuse("A Requested transfer is cancelled with Cancel Request (no stock has moved).");
    return refuse("A Requested transfer is dispatched first (In Progress), then received.");
  }
  if (stored === "In Progress") {
    if (saveAs === "Completed") return { decision: "RECEIVE", message: "" };
    if (saveAs === "Cancelled") return { decision: "CANCEL", message: "" };
    return refuse("This dispatched request can't be edited: receive it as it was dispatched, or cancel it.");
  }
  if (stored === "Processing") return { decision: "NONE", message: "" };
  return refuse("This transfer request is " + (stored || "without a status") + " and can't be saved again.");
};
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
const trArg = arguments[0] || {};
const trS = iatrS;
const TR_ALL = ["tr_section", "tr_pick", "tr_btn_create", "tr_btn_view", "tr_btn_refresh", "tr_btn_cancel", "tr_btn_new", "tr_btn_replace", "tr_btn_defect"];
const trDigits = (v) => /^[0-9]{1,20}$/.test(trS(v));
const trNum = (v) => {
  const x = parseFloat(v);
  return isFinite(x) ? Number(x.toFixed(8)) : 0;
};
const trStore = (p) => {
  this.models["_tr"] = Object.assign({}, this.models["_tr"] || {}, p);
};
const trState = () => this.models["_tr"] || {};
const trRun = (params) => new Promise((resolve, reject) => this.runWorkflow(IATR_WF, params, (r) => resolve(r), (e) => reject(e)));
const trKey = (op, id) => ("IATR:" + trS(id) + ":" + op + ":" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).slice(0, 128);
// the IA as this screen shows it (iatr_ia.js iatrIaFp: the server compares it with the stored IA)
const trFp = (v) => iatrIaFp(iatrBasis({ plant: v.issuing_operation_faci, item_id: v.item_id, item_qty: v.item_qty, planned_output_qty: v.planned_output_qty,
  bom_consumption_mode: v.bom_consumption_mode, source_bom_id: v.source_bom_id }), Array.isArray(v.stock_movement) ? v.stock_movement : []);
const trYmd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
// a date widget's value (a timestamp or text) as the local YYYY-MM-DD
const trDate = (v) => (typeof v === "number" && isFinite(v) && v > 0 ? trYmd(new Date(v)) : trS(v).slice(0, 10));
const trPicks = (l) => {
  try {
    const x = JSON.parse(trS(l && l.temp_qty_data) || "[]");
    return (Array.isArray(x) ? x : []).filter((p) => p && typeof p === "object" && trNum(p.sm_quantity) > 0);
  } catch (e) {
    return [];
  }
};
// the organisation's Item Assembly Setup (D12): Transfer Request on? No row = off
const trSetupOn = async (v) => {
  try {
    const res = await db.collection("item_assembly_setup").where({ organization_id: trS(v.organization_id), is_deleted: 0 }).get();
    return ((res && res.data) || []).some((r) => r && Number(r.transfer_request_enabled) === 1);
  } catch (e) {
    console.error("IA transfer request: the setup could not be read", e);
    return false;
  }
};
const trStatus = async (v) => {
  try {
    const res = await trRun({ operation: "STATUS", ia_id: trS(v.id), organization_id: trS(v.organization_id) });
    const d = (res && res.data) || {};
    if (trS(d.code) !== "200") {
      console.error("IA transfer request: status", d);
      return null;
    }
    return JSON.parse(trS(d.result_json) || "{}");
  } catch (e) {
    console.error("IA transfer request: status failed", e);
    return null;
  }
};
// the section from STATUS (its request = the open one, else the received one, else the newest)
const trRender = (page, iaStatus, res, offer) => {
  this.hide(TR_ALL);
  const r = res && res.request ? res.request : null;
  const st = r ? trS(r.status) : "";
  const no = r ? trS(r.no) || trS(r.id) : "";
  const editable = page === "Edit";
  const gap = res && Array.isArray(res.gap) ? res.gap : [];
  trStore({ request: r, page: page, iaStatus: iaStatus, res: res || null });
  const show = [];
  let info;
  if (!r || st === "Cancelled") {
    if (!(editable && res && trS(res.can_create) === "YES")) return;
    if (!offer) {
      this.display(["tr_btn_new"]);
      return;
    }
    info = r ? "Transfer request " + no + " was cancelled. Choose the staging bin and the date to request the reserved materials again."
      : "Request this Item Assembly's reserved materials from the warehouse: choose the staging storage location and bin, and the date they are required.";
    show.push("tr_section", "tr_pick", "tr_btn_create");
  } else if (st === "In Progress" || st === "Processing") {
    info = "In transit (" + no + "): this Item Assembly can't be changed until the request is received.";
    show.push("tr_section", "tr_btn_view");
  } else if (st === "Completed") {
    info = "Transfer request " + no + " received: its materials are reserved for this Item Assembly at the staging bin.";
    if (gap.length) info += " " + gap.length + " line(s) still need materials: request a replacement.";
    else if (trS(res.replace_ready) === "YES") info += " The missing materials are reserved: request the replacement.";
    show.push("tr_section", "tr_btn_view");
    if (editable && iaStatus === "Created") {
      if (gap.length || trS(res.replace_ready) === "YES") show.push("tr_btn_replace");
      show.push("tr_btn_defect");
    }
  } else {
    info = "Transfer request " + no + " · " + st;
    if (st === "Requested" && trS(r.stale) === "YES") info += " · this Item Assembly's reservation changed since it was made: refresh it";
    show.push("tr_section", "tr_btn_view");
    if (st === "Requested" && editable) show.push("tr_btn_refresh", "tr_btn_cancel");
  }
  // the IA's requests, newest first (a replacement, its received request, a cancelled one), once there is more than one
  const history = res && Array.isArray(res.history) ? res.history.filter((h) => h && trS(h.no)) : [];
  if (history.length > 1) info += " · Requests: " + history.map((h) => trS(h.no) + " (" + trS(h.status) + ")").join(", ");
  this.setData({ tr_info: info });
  this.display(show);
};
// after an operation: the section from STATUS now (an unreadable status keeps what is shown)
const trAgain = async (v) => {
  const st = trState();
  const res = await trStatus(v);
  if (res) trRender(st.page || "Edit", st.iaStatus || trS(v.item_assembly_status), res);
  return res;
};
const trAnswer = async (v, res, failed) => {
  const d = (res && res.data) || {};
  if (trS(d.code) === "200") {
    this.$message.success(trS(d.message) || "Done.");
    try {
      const out = JSON.parse(trS(d.result_json) || "{}");
      if (out.request && trDigits(out.request.id)) this.setData({ transfer_request_id: trS(out.request.id), transfer_request_no: trS(out.request.no) });
    } catch (e) {}
    await trAgain(v);
    return true;
  }
  this.$message.error(trS(d.message) || failed);
  return false;
};
const trConfirm = (text, title, ok) => this.$confirm(text, title, { confirmButtonText: ok, cancelButtonText: "Not now", type: "warning" }).then(() => true, () => false);
// the replacement offered once per receipt and browser (D6): right after a Receive (RELOAD), else at the next open of the IA (a Receive
// done from the Location Transfer list); declined, Request Replacement stays. A browser that can't remember is not offered at open
const TR_OFFER = "iatr-offer:";
const trOffered = (id) => {
  try {
    return localStorage.getItem(TR_OFFER + id) === "1";
  } catch (e) {
    return true;
  }
};
const trOffer = async (v, res) => {
  try {
    localStorage.setItem(TR_OFFER + trS(res.request.id), "1");
  } catch (e) {}
  const ok = await trConfirm(res.gap.length + " line(s) of this Item Assembly still need materials after the receipt (a defect, or never reserved). Allocate them now for a "
    + "replacement request? You can do it later with Request Replacement.", "Request a replacement", "Allocate");
  if (ok) await trReplace(v, res);
};
// received with something missing, on an editable Created IA
const trDue = (res, page, iaStatus) => !!(res && res.request && trS(res.request.status) === "Completed" && Array.isArray(res.gap) && res.gap.length && page === "Edit" &&
  iaStatus === "Created");
// Request Replacement: something missing -> its allocation (sc_main GAP); the reservation ready -> REPLACE to the staging bin, dated today
const trReplace = async (v, res) => {
  const gap = res && Array.isArray(res.gap) ? res.gap : [];
  const staging = (res && res.staging) || {};
  if (gap.length) {
    this.triggerEvent("sc_main", { scOp: "GAP", gap: gap, bin: trS(staging.bin) });
    return;
  }
  if (!res || trS(res.replace_ready) !== "YES") return;
  this.showLoading("Requesting the replacement...");
  let out = null;
  try {
    out = await trRun({ operation: "REPLACE", ia_id: trS(v.id), organization_id: trS(v.organization_id), expected_fp: trFp(v), storage_location_id: trS(staging.sl),
      location_id: trS(staging.bin), required_date: trYmd(new Date()), idempotency_key: trKey("replace", v.id) });
  } catch (e) {
    console.error("IA transfer request: replace failed", e);
  }
  this.hideLoading();
  await trAnswer(v, out, "The replacement request could not be made. Please try again.");
};
// Report Defect: one row per pick at the staging bin (a batch line per batch), its batch number read
const trDefectRows = async (v, bin) => {
  const rows = [];
  for (const l of Array.isArray(v.stock_movement) ? v.stock_movement : []) {
    if (!l || !trDigits(l.id)) continue;
    for (const p of trPicks(l)) {
      if (trS(p.location_id) !== trS(bin) || trS(p.handling_unit_id)) continue;
      rows.push({ line_id: trS(l.id), item: trS(l.item_name) || trS(l.item_selection), batch_id: trS(p.batch_id), batch: "", at_bin: trNum(p.sm_quantity), defect: 0, reason: "" });
    }
  }
  const ids = Array.from(new Set(rows.map((r) => r.batch_id).filter((x) => x)));
  if (ids.length) {
    try {
      const res = await db.collection("batch").filter([{ type: "branch", operator: "all", children: [{ prop: "id", operator: "in", value: ids },
        { prop: "is_deleted", operator: "equal", value: 0 }] }]).limit(ids.length).get();
      const no = {};
      for (const b of (res && res.data) || []) no[trS(b.id)] = trS(b.batch_number);
      rows.forEach((r) => (r.batch = r.batch_id ? no[r.batch_id] || r.batch_id : ""));
    } catch (e) {
      rows.forEach((r) => (r.batch = r.batch_id));
    }
  }
  return rows;
};
// the dialog's rows -> DEFECT's { <IA line id>: { qty, reason } | { batches: { <batch id>: qty }, reason } }, or the reason it can't go
const trDefects = (rows) => {
  const out = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    const q = trNum(r && r.defect);
    if (!(q > 0)) continue;
    const label = trS(r.item) + (trS(r.batch) ? " (" + trS(r.batch) + ")" : "");
    if (q - trNum(r.at_bin) > 1e-8) return { why: label + ": at most " + trNum(r.at_bin) + " is at the staging bin." };
    if (!trS(r.reason)) return { why: label + ": choose the reason for the defect." };
    const d = out[trS(r.line_id)] || (out[trS(r.line_id)] = { reason: trS(r.reason) });
    if (d.reason !== trS(r.reason)) return { why: trS(r.item) + ": one reason per line - choose the same reason for its batches." };
    if (trS(r.batch_id)) {
      d.batches = d.batches || {};
      d.batches[trS(r.batch_id)] = String(trNum((trNum(d.batches[trS(r.batch_id)]) || 0) + q));
    } else d.qty = String(trNum(trNum(d.qty) + q));
  }
  if (!Object.keys(out).length) return { why: "Enter the defective quantity of at least one line." };
  const defects = {};
  for (const id of Object.keys(out)) defects[id] = out[id].batches ? { batches: out[id].batches, reason: out[id].reason } : { qty: out[id].qty, reason: out[id].reason };
  return { defects: defects };
};

(async () => {
  const op = trS(trArg.trOp);
  try {
    if (op === "MOUNT") {
      const page = trS(trArg.pageStatus);
      if (TR_ENABLED !== true || (page !== "Edit" && page !== "View")) return;
      const v = this.getValues();
      if (!trDigits(v.id)) return;
      const iaStatus = trS(trArg.status) || trS(v.item_assembly_status);
      trStore({ request: null, page: page, iaStatus: iaStatus, res: null });
      if (!trS(v.transfer_request_id)) {
        // no request yet: only an editable Created IA of an organisation with Transfer Request on may make one (D12)
        if (page !== "Edit" || iaStatus !== "Created" || !(await trSetupOn(v))) return;
      }
      const res = await trStatus(v);
      if (res) trRender(page, iaStatus, res);
      if (trDue(res, page, iaStatus) && !trOffered(trS(res.request.id))) await trOffer(v, res);
      return;
    }
    if (op === "NEW") {
      const st = trState();
      trRender(st.page || "Edit", st.iaStatus || "Created", Object.assign({}, st.res || {}, { request: st.request || null, can_create: "YES" }), true);
      return;
    }
    // the request's form closed after a save opened from View Transfer Request: its section drawn again; just received with something
    // missing (D6): the replacement offered
    if (op === "RELOAD") {
      const v = this.getValues();
      if (TR_ENABLED !== true || !trDigits(v.id) || !trS(v.transfer_request_id)) return;
      const was = trS((trState().request || {}).status);
      const res = await trAgain(v);
      const st = trState();
      if (was !== "Completed" && trDue(res, st.page, st.iaStatus)) await trOffer(v, res);
      return;
    }
    if (op === "STORAGE") {
      this.setData({ tr_location_id: "" });
      return;
    }
    const v = this.getValues();
    const r = trState().request || {};
    if (op === "VIEW") {
      if (!trDigits(r.id)) return;
      const edit = trS(r.status) === "In Progress";
      // on the right, as every form opens (the user, 10-28)
      const view = { target: LOT_FORM, type: edit ? "edit" : "view", mode: "dialog", position: "rtl", title: edit ? "Edit" : "View", width: "80%", data: { id: trS(r.id) } };
      if (!edit) view.viewMode = "disabled";
      this.toView(view);
      return;
    }
    if (op === "CREATE") {
      const sl = trS(v.tr_storage_location_id);
      const bin = trS(v.tr_location_id);
      const date = trDate(v.tr_required_date);
      if (!trDigits(sl) || !trDigits(bin) || !date) {
        this.$message.warning("Choose the staging storage location, the bin and the date the materials are required.");
        return;
      }
      this.showLoading("Creating the transfer request...");
      let res = null;
      try {
        res = await trRun({ operation: "CREATE", ia_id: trS(v.id), organization_id: trS(v.organization_id), expected_fp: trFp(v), storage_location_id: sl, location_id: bin,
          required_date: date, idempotency_key: trKey("create", v.id) });
      } catch (e) {
        console.error("IA transfer request: create failed", e);
      }
      this.hideLoading();
      await trAnswer(v, res, "The transfer request could not be created. Please try again.");
      return;
    }
    if (op === "REPLACE") {
      await trReplace(v, trState().res);
      return;
    }
    if (op === "DEFECT_OPEN") {
      const staging = (trState().res || {}).staging || {};
      const rows = await trDefectRows(v, trS(staging.bin));
      if (!rows.length) {
        this.$message.warning("Nothing of this Item Assembly is picked at the staging bin.");
        return;
      }
      // a dialog's children are addressed through it (sc_main's "sc_line_dialog.sc_line_table")
      this.setData({ "tr_defect_dialog.tr_defect_table": rows });
      await this.openDialog("tr_defect_dialog");
      return;
    }
    if (op === "DEFECT_CLOSE") {
      await this.closeDialog("tr_defect_dialog");
      return;
    }
    if (op === "DEFECT") {
      const d = trDefects((this.getValues().tr_defect_dialog || {}).tr_defect_table);
      if (d.why) {
        this.$message.warning(d.why);
        return;
      }
      this.showLoading("Reporting the defect...");
      let res = null;
      try {
        res = await trRun({ operation: "DEFECT", ia_id: trS(v.id), organization_id: trS(v.organization_id), defects: JSON.stringify(d.defects), idempotency_key: trKey("defect", v.id) });
      } catch (e) {
        console.error("IA transfer request: defect failed", e);
      }
      this.hideLoading();
      if (trS(((res && res.data) || {}).code) === "200") await this.closeDialog("tr_defect_dialog");
      await trAnswer(v, res, "The defect could not be reported. Please try again.");
      return;
    }
    if (op === "REFRESH" || op === "CANCEL") {
      if (!trDigits(r.id)) return;
      const refresh = op === "REFRESH";
      const ok = await trConfirm(refresh ? "Refresh transfer request " + trS(r.no) + " from this Item Assembly's reservation? Its lines and picks become what is reserved now." :
        "Cancel transfer request " + trS(r.no) + "? Nothing has moved yet: the Item Assembly keeps its reservation, and you can make a new request afterwards.",
      refresh ? "Refresh transfer request" : "Cancel transfer request", refresh ? "Refresh" : "Cancel Request");
      if (!ok) return;
      this.showLoading(refresh ? "Refreshing the transfer request..." : "Cancelling the transfer request...");
      const params = { operation: op, ia_id: trS(v.id), organization_id: trS(v.organization_id), lot_id: trS(r.id), idempotency_key: trKey(op.toLowerCase(), v.id) };
      if (refresh) params.expected_fp = trFp(v);
      let res = null;
      try {
        res = await trRun(params);
      } catch (e) {
        console.error("IA transfer request: " + op + " failed", e);
      }
      this.hideLoading();
      await trAnswer(v, res, "The transfer request could not be " + (refresh ? "refreshed" : "cancelled") + ". Please try again.");
    }
  } catch (error) {
    this.hideLoading();
    console.error("IA transfer request:", error);
    this.$message.error(error.message || "Transfer request: something went wrong");
  }
})();
