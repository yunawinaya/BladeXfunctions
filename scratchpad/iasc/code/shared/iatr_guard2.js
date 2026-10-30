// IA transfer requests from a reserved Item Assembly (Item Assembly & BOM/TransferRequest/RESERVED_REQUEST_DESIGN.md D4, D11): the
// IA's guard, shared by IA_SAVE v16 (code_node_IAguardStored, code_node_IAtrPicks) and IA_V2_SUBMIT v8 (code_node_ISentry, code_node_ISgate).
// Pure, ES2015; every name iatrg2 / IATRG2_-prefixed; needs scratchpad/iatr/code/shared/iatr_reserve.js's rrStagingCheck before it.
// The read (code/shared/iatr_sql2.py) gives ALL of the IA's supply requests (id, no, status, bin = its first line's location_id, bin_name)
// and, for IA_SAVE, the items of the save's lines (stock / serial flags; IA_V2_SUBMIT has its own items read).
//   any save while a request is in transit (In Progress / Processing, or a status this guard does not know: fail closed) -> IA_TR_TRANSIT
//   a completion while any request is open (Requested too)                                                                -> IA_TR_OPEN
//   a completion once a request was received: every line a request can carry picked at the staging bin (D11)             -> IA_TR_STAGING
//   a Created save (before a request, or after a receipt for a replacement's new reservation) and a Draft save: go on
const IATRG2_KNOWN = ["Requested", "In Progress", "Processing", "Completed", "Cancelled"];
const IATRG2_OPEN = ["Requested", "In Progress", "Processing"];
const IATRG2_TRANSIT = ["In Progress", "Processing"];
const IATRG2_FINAL = ["Completed", "Fully Posted"];
const IATRG2_TEXT = {
  transit: (no, status) => "The materials of this Item Assembly are being transferred (transfer request " + no + " is " + status + "): it can't be changed until that request is received.",
  open: (no, status) => "Transfer request " + no + " of this Item Assembly is " + status + ": receive it or cancel it before completing the Item Assembly.",
  unreadable: "The transfer requests of this Item Assembly could not be read, so it can't be saved as Created or Completed now: please try again.",
  staging: (n, item, bin, no) => "Line " + n + " (" + item + "): take it from " + bin + ", where transfer request " + no + " delivered the materials; request a replacement for what is missing.",
  noBin: (no) => "Transfer request " + no + " of this Item Assembly has no staging bin on record, so the Item Assembly can't be completed now: please contact support.",
};
const iatrg2S = (v) => (v === undefined || v === null ? "" : String(v)).trim();
// an id as text; a number past 2^53 is marked, never silently equal
const iatrg2Id = (v) => {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? String(v) : "?" + String(v);
  return iatrg2S(v);
};
// JSON text whose 16+ digit numbers stay text (a 19-digit id read as a number loses digits); undefined = not JSON
const iatrg2Parse = function iatrg2Parse(t) {
  if (t !== null && typeof t === "object") return t;
  try {
    return JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))/g, (m, pre, num) => (num === undefined ? m : pre + '"' + num + '"')));
  } catch (e) {
    return undefined;
  }
};
// the read's column: NULL (not read, or no row) = no request; { bad: true } = not the read's shape (a request without an id included)
const iatrg2Read = function iatrg2Read(v) {
  const bad = { bad: true, reqs: [], items: {} };
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return { bad: false, reqs: [], items: {} };
  const r = iatrg2Parse(v);
  if (!r || typeof r !== "object" || Array.isArray(r)) return bad;
  const listOf = (x) => (x === undefined || x === null ? [] : Array.isArray(x) ? x : null);
  const rows = listOf(r.reqs);
  const itemRows = listOf(r.items);
  if (!rows || !itemRows || rows.some((x) => !x || typeof x !== "object" || !iatrg2Id(x.id))) return bad;
  const items = {};
  for (const it of itemRows) if (it && typeof it === "object" && iatrg2Id(it.id)) items[iatrg2Id(it.id)] = it;
  return { bad: false, reqs: rows.map((x) => ({ id: iatrg2Id(x.id), no: iatrg2S(x.no), status: iatrg2S(x.status), bin: iatrg2Id(x.bin), binName: iatrg2S(x.bin_name) })), items: items };
};
// snowflake ids as text, newest first
const iatrg2Newest = (a, b) => (a.id.length !== b.id.length ? b.id.length - a.id.length : a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
// the save's outcome as code_fillback writes it (code/classic/fillback_status.js): the Draft path (saveAs exactly "Draft") saves it
// Created with ia_target_status Created or when it is stored Created, else Draft; any other saveAs completes it
const iatrg2Outcome = (draftPath, targetCreated, stored) => (!draftPath ? "COMPLETED" : targetCreated || stored === "Created" ? "CREATED" : "DRAFT");
// what the save may do: refuse (400: code, message), or go on - picks YES: a completion after a receipt, its lines to check (D11)
const iatrg2Decide = function iatrg2Decide(read, outcome, stored) {
  const go = { refuse: false, code: "", message: "", picks: false };
  if (IATRG2_FINAL.indexOf(iatrg2S(stored)) >= 0) return go;
  if (!read || read.bad) return outcome === "DRAFT" ? go : { refuse: true, code: "IA_TR_UNREADABLE", message: IATRG2_TEXT.unreadable, picks: false };
  const reqs = read.reqs.slice().sort(iatrg2Newest);
  const moving = reqs.filter((r) => IATRG2_KNOWN.indexOf(r.status) < 0 || IATRG2_TRANSIT.indexOf(r.status) >= 0)[0];
  if (moving) return { refuse: true, code: "IA_TR_TRANSIT", message: IATRG2_TEXT.transit(moving.no || moving.id, moving.status || "without a status"), picks: false };
  if (outcome !== "COMPLETED") return go;
  const open = reqs.filter((r) => IATRG2_OPEN.indexOf(r.status) >= 0)[0];
  if (open) return { refuse: true, code: "IA_TR_OPEN", message: IATRG2_TEXT.open(open.no || open.id, open.status), picks: false };
  return { refuse: false, code: "", message: "", picks: reqs.some((r) => r.status === "Completed") };
};
// a completion after a receipt (D11, rrStagingCheck): every line a request can carry picked at the newest received request's staging
// bin; serial-numbered, handling-unit and non-stock lines picked as today. lines = the save's IA lines in order (Line n = its position);
// items: the lines' items by id (IA_V2_SUBMIT's own read), else the read's
const iatrg2Staging = function iatrg2Staging(lines, read, items) {
  const recv = (read && read.reqs ? read.reqs : []).filter((r) => r.status === "Completed").sort(iatrg2Newest)[0];
  if (!recv) return { ok: true, code: "", message: "" };
  if (!recv.bin) return { ok: false, code: "IA_TR_STAGING", message: IATRG2_TEXT.noBin(recv.no || recv.id) };
  const list = Array.isArray(lines) ? lines : [];
  const c = rrStagingCheck(list, read.reqs, items || read.items, recv.bin);
  if (c.ok) return { ok: true, code: "", message: "" };
  const l = list[c.line - 1] || {};
  return { ok: false, code: "IA_TR_STAGING", message: IATRG2_TEXT.staging(c.line, iatrg2S(l.item_name) || iatrg2Id(l.item_selection), recv.binName || recv.bin, recv.no || recv.id) };
};
if (typeof module !== "undefined") module.exports = { IATRG2_KNOWN, IATRG2_OPEN, IATRG2_TRANSIT, IATRG2_FINAL, IATRG2_TEXT, iatrg2S, iatrg2Id, iatrg2Parse, iatrg2Read, iatrg2Newest, iatrg2Outcome, iatrg2Decide, iatrg2Staging };
