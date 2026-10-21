// LOT_V2_SUBMIT - shared helpers (with code/shared/lot_common.js included before this file)
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r !== undefined && r !== null);
const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
const num = (v) => Number(v || 0);
const MAX_OLD_PATH_LINES = 500;
const MAX_ROWS = 2500;
const MAX_MOVEMENTS = 5000;
const OPEN_JOB = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_LOT", "REQUIRES_REVIEW"];
// NONE: STATUS found no job for the LOT (the form stops polling)
const TERMINAL_JOB = ["COMPLETED", "FAILED", "REQUIRES_REVIEW", "CANCELLED", "NONE"];
// the actions this build queues; any other derived action answers NOT_ELIGIBLE (-> the classic save)
const BUILT_ACTIONS = ["DRAFT", "DIRECT", "STAGE", "COMPLETE", "EDIT", "CANCEL"];
const answer = (route, code, message, extra) => Object.assign({ route: route, code: String(code), message: message || "" }, extra || {});
// NOT_ELIGIBLE goes to the classic save, which refuses more than 500 lines unless Draft: above that it is a STOP here
const notEligible = (reason, lineCount, saveAs) =>
  lineCount > MAX_OLD_PATH_LINES && saveAs !== "Draft"
    ? answer("STOP", "400", "This Location Transfer has " + lineCount + " lines and cannot be saved in the background (" + reason + "); the classic save handles at most "
      + MAX_OLD_PATH_LINES + " lines.", { reason: reason, errorCode: "LOT_TOO_BIG" })
    : answer("NOT_ELIGIBLE", "300", reason, { reason: reason, errorCode: "LOT_NOT_ELIGIBLE" });
// code_node_yPlLXIZW's walk: rows then their children; bundle parents (item_bundle_id, no parent_fm_key) excluded
const flatOf = (rows) => {
  const out = [];
  const isBundleParent = (row) => Boolean(row.item_bundle_id && !row.parent_fm_key);
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    if (!isBundleParent(row)) out.push(row);
    for (const c of Array.isArray(row.children) ? row.children : []) if (c && typeof c === "object" && !isBundleParent(c)) out.push(c);
  }
  return out;
};
// every row of a stock_movement tree, parents and children (the stored rows: what FP_LINES reads back)
const lotTreeRows = (rows) => {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    out.push(row);
    for (const c of Array.isArray(row.children) ? row.children : []) if (c && typeof c === "object") out.push(c);
  }
  return out;
};
// a stored row (no parent_fm_key in the table) is a bundle parent when it names a bundle and has no parent row
const lotStoredFlat = (rows) => list(rows).filter((r) => !(s(r.item_bundle_id) && !digits(r.parent_id)));
// code_node_LOTallocPrep's rule (V2.1): a line the classic auto-allocates before its gates; PREPARE allocates it
const lotNeedsAlloc = (row) => {
  const t = row && typeof row.temp_qty_data === "string" ? row.temp_qty_data.trim() : "";
  return Boolean(row) && (parseFloat(row.requested_qty) || 0) > 0 && (typeof row.temp_qty_data !== "string" || t === "" || t === "[]") && Boolean(row.item_selection);
};
const parseJson = (t) => {
  if (t && typeof t === "object") return t;
  return lotParseJ(t);
};
// a line set the background save does not take (form lines or stored lines): HU, serial lines, and entries that move HU or a
// category other than Unrestricted / Blocked (bundles and lines waiting for auto-allocation are taken since V2.1)
const LOT_OK_CATEGORIES = ["", "Unrestricted", "Blocked", "UNR", "BLK"];
const lotLineReasons = function lotLineReasons(flat) {
  for (const l of flat) {
    if (lotJsonList(l.temp_hu_data).length || s(l.handling_unit_id)) return "it has handling units";
    if (num(l.is_serialized_item) === 1) return "it has serial-numbered items";
    for (const e of lotJsonList(l.temp_qty_data)) {
      if (!e || typeof e !== "object" || !(lotQ8(e.sm_quantity) > 0)) continue;
      if (s(e.handling_unit_id)) return "it has handling units";
      if (LOT_OK_CATEGORIES.indexOf(s(e.category)) < 0) return "it moves " + s(e.category) + " stock";
    }
  }
  return "";
};
// the read-back of a queued save: the LOT Processing under this job, its latest lock this key, the job QUEUED, the S parts all there
const lotQueuedOk = (guard, post, b) => digits(b.job_id) && s(b.stock_movement_status) === "Processing" && s(b.lot_v2_job_id) === s(b.job_id) && s(b.lock_ref) === guard.key
  && s(b.job_status) === "QUEUED" && /^LOT\|[0-9]{1,20}$/.test(s(b.correlation_id)) && num(b.parts) === num(post.partCount);
