// IA transfer request (ENH-20261027-001, spec IA-LT-06): the Item Assembly's guard, shared by IA_SAVE v15 (code_node_IAguardStored,
// code_node_IAtrPicks) and IA_V2_SUBMIT v7 (code_node_ISentry, code_node_ISgate). Pure, ES2015; every name iatrg / IATRG_-prefixed so it
// concatenates with a node's own helpers. The guard's read (code/shared/iatr_sql.py) gives the IA's latest supply request that is not
// Cancelled as JSON text: id, no, status, bin (its first line's location_id), bin_name, lines (its lines' source_ia_line_id).
// A save making the IA Created or Completed while that request still moves (Requested / In Progress / Processing, or a status this guard
// does not know: fail closed) is refused; once it is received (Completed), every pick of a line it supplied must be at its destination
// bin. Draft saves, an IA without a request or with only Cancelled ones, and an IA already completed: nothing.
const IATRG_RECEIVED = "Completed";
// an IA already completed: its own guards answer (a Draft save 409, a second completion refused)
const IATRG_FINAL = ["Completed", "Fully Posted"];
const IATRG_TEXT = {
  live: (no, status) => "The materials of this Item Assembly are still being transferred (transfer request " + no + " is " + status + "): receive it first, or cancel it.",
  unreadable: "The transfer request of this Item Assembly could not be read, so it can't be saved as Created or Completed now: please try again.",
  pick: (n, item, bin, no) => "Line " + n + " (" + item + "): pick it from " + bin + ", where transfer request " + no + " delivered it.",
};
const iatrgS = (v) => (v === undefined || v === null ? "" : String(v)).trim();
// an id as text; a number past 2^53 is marked, never silently equal
const iatrgId = (v) => {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? String(v) : "?" + String(v);
  return iatrgS(v);
};
// JSON text whose 16+ digit numbers stay text (a 19-digit id read as a number loses digits); undefined = not JSON
const iatrgParse = function iatrgParse(t) {
  if (t !== null && typeof t === "object") return t;
  try {
    return JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))/g, (m, pre, num) => (num === undefined ? m : pre + '"' + num + '"')));
  } catch (e) {
    return undefined;
  }
};
// the picks the issue takes from a line (sm_quantity above 0; temp_qty_data a JSON text or an array; unreadable = none)
const iatrgPicksOf = function iatrgPicksOf(line) {
  const v = line && line.temp_qty_data;
  const list = Array.isArray(v) ? v : iatrgParse(v);
  return (Array.isArray(list) ? list : []).filter((p) => p && typeof p === "object" && (parseFloat(p.sm_quantity) || 0) > 0);
};
// the request in the read's column: null = none (no row, or a Cancelled one); { bad: true } = a value that is not a request
const iatrgRequest = function iatrgRequest(v) {
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return null;
  const r = iatrgParse(v);
  if (!r || typeof r !== "object" || !iatrgId(r.id)) return { bad: true };
  if (iatrgS(r.status) === "Cancelled") return null;
  if (r.lines !== undefined && r.lines !== null && !Array.isArray(r.lines)) return { bad: true };
  const lines = {};
  for (const x of r.lines || []) if (iatrgId(x)) lines[iatrgId(x)] = true;
  return { bad: false, id: iatrgId(r.id), no: iatrgS(r.no), status: iatrgS(r.status), bin: iatrgId(r.bin), binName: iatrgS(r.bin_name), lines: lines };
};
// the save's outcome as code_fillback writes it (code/classic/fillback_status.js): the Draft path (saveAs exactly "Draft") saves it
// Created with ia_target_status Created or when it is stored Created, else Draft; any other saveAs completes it
const iatrgOutcome = (draftPath, targetCreated, stored) => (!draftPath ? "COMPLETED" : targetCreated || stored === "Created" ? "CREATED" : "DRAFT");
// what the save may do: refuse (400: code, message), or go on - with the picks of the request's lines to check when it was received
const iatrgDecide = function iatrgDecide(req, outcome, stored) {
  const go = { refuse: false, code: "", message: "", picks: false };
  if ((outcome !== "CREATED" && outcome !== "COMPLETED") || !req || IATRG_FINAL.indexOf(iatrgS(stored)) >= 0) return go;
  if (req.bad) return { refuse: true, code: "IA_TR_UNREADABLE", message: IATRG_TEXT.unreadable, picks: false };
  if (req.status === IATRG_RECEIVED) return { refuse: false, code: "", message: "", picks: Object.keys(req.lines).length > 0 };
  return { refuse: true, code: "IA_TR_LIVE", message: IATRG_TEXT.live(req.no || req.id, req.status || "without a status"), picks: false };
};
// a received request: every pick of a line it supplied (the line's id among its lines) at its destination bin; the first line off it
// refuses. lines = the save's IA lines in order (Line n = the line_index code_fillback writes); a line the request did not supply is free
const iatrgPicks = function iatrgPicks(lines, req) {
  const list = Array.isArray(lines) ? lines : [];
  const at = (p) => req.bin !== "" && iatrgId(p.location_id) === req.bin;
  for (let i = 0; i < list.length; i++) {
    const l = list[i];
    if (!l || typeof l !== "object" || req.lines[iatrgId(l.id)] !== true) continue;
    if (iatrgPicksOf(l).some((p) => !at(p))) {
      return { ok: false, code: "IA_TR_PICK", message: IATRG_TEXT.pick(i + 1, iatrgS(l.item_name) || iatrgId(l.item_selection), req.binName || req.bin || "its destination bin",
        req.no || req.id) };
    }
  }
  return { ok: true, code: "", message: "" };
};
if (typeof module !== "undefined") module.exports = { IATRG_RECEIVED, IATRG_FINAL, IATRG_TEXT, iatrgS, iatrgId, iatrgParse, iatrgPicksOf, iatrgRequest, iatrgOutcome, iatrgDecide, iatrgPicks };
