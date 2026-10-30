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
if (typeof module !== "undefined") module.exports = { IATR_PURPOSE, iatrS, iatrQ8, iatrParse, iatrId, iatrHash, iatrDemand, iatrFingerprint, iatrDispatchCheck, iatrTransition };
