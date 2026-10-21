// IDA V2 shared helpers (CONTRACT.md section 6): every name ida / IDA_-prefixed so it concatenates with a step's own helpers
const idaS = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const idaQ8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
// a decimal column as the fixed-scale STRING the multipleOf check accepts
const idaQtyStr = (v) => Math.max(0, idaQ8(v)).toFixed(8);
const idaDigits = (v) => /^[0-9]{1,20}$/.test(idaS(v));
const idaIdStr = (v) => {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? String(v) : "";
  const t = idaS(v);
  return /^[0-9]{1,20}$/.test(t) ? t : "";
};
// digit text compared as numbers without a JS number: longer is greater, then lexicographic (snowflake ids have no leading zeros)
const idaIdAfter = (id, jobId) => {
  const a = idaS(id);
  const b = idaS(jobId);
  return idaDigits(a) && idaDigits(b) && (a.length > b.length || (a.length === b.length && a > b));
};
// 16+ digit integer tokens stay strings (never a float's fraction digits)
const idaParseJ = (t) => {
  if (t === undefined || t === null) return null;
  if (typeof t === "object") return t;
  try {
    return JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))/g, (m, pre, num) => (num === undefined ? m : pre + '"' + num + '"')));
  } catch (e) {
    return null;
  }
};
const idaList = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r !== undefined && r !== null);
const idaJsonList = (v) => {
  if (Array.isArray(v)) return v;
  const t = idaS(v);
  if (!t) return [];
  const p = idaParseJ(t);
  return Array.isArray(p) ? p : [];
};
const idaRows = (rows) => idaList(rows).map((r) => (r && typeof r === "object" && typeof r.j === "string" ? idaParseJ(r.j) : r)).filter((r) => r && typeof r === "object");
const idaIdsSql = (vals) => {
  const seen = { "0": true };
  const out = ["0"];
  for (const v of Array.isArray(vals) ? vals : Object.keys(vals || {})) {
    const x = idaIdStr(v);
    if (x && seen[x] !== true) {
      seen[x] = true;
      out.push(x);
    }
  }
  return out.join(",");
};
// one JSON text of digit arrays for JSON_TABLE (each tuple once; a tuple with a non-digit element is dropped)
const idaTuples = (rows) => {
  const seen = {};
  for (const r of idaList(rows)) {
    if (!Array.isArray(r) || !r.length) continue;
    const t = r.map(idaS);
    if (t.every((x) => /^[0-9]{1,20}$/.test(x))) seen["[" + t.join(",") + "]"] = true;
  }
  return "[" + Object.keys(seen).join(",") + "]";
};
// code_issue_pick: pick.category || 'Unrestricted'
const idaCategory = (c) => idaS(c) || "Unrestricted";
// the source picks are on the HEADER (code_issue_prep's filter): temp_qty_data entries with sm_quantity > 0, array order
const idaPicks = (header) => idaJsonList(header && header.temp_qty_data).filter((p) => p && typeof p === "object" && (parseFloat(p.sm_quantity) || 0) > 0);
const idaPickCount = (header) => idaPicks(header).length;
// a recovery line = a stock_movement row with an item
const idaRecoveryLines = (lines) => idaList(lines).filter((l) => l && typeof l === "object" && idaS(l.item_selection) !== "");
// moves (CONTRACT.md section 1): picks + recovery lines - the client's > 50, the classic's 250 cap, SUBMIT's NOT_ELIGIBLE / TOO_BIG
const idaMoveCount = (header, lines) => idaPickCount(header) + idaRecoveryLines(lines).length;
const idaHasHu = (header) => {
  const h = header || {};
  return idaJsonList(h.temp_qty_data).some((p) => p && typeof p === "object" && idaS(p.handling_unit_id) !== "")
    || idaJsonList(h.temp_hu_data).length > 0 || idaJsonList(h.table_hu).length > 0;
};
const idaPickHasSerial = (header) => idaJsonList(header && header.temp_qty_data).some((p) => p && typeof p === "object" && idaS(p.serial_number) !== "");
const IDA_AUTO_RULE = "According To System Settings";
const IDA_BATCH_PLACEHOLDER = "Auto-generated batch number";
// AUTO = the classic code_batch_plan rule exactly (raw text); TYPED = any other real text; NONE else (CONTRACT.md section 5)
const idaBatchKind = function idaBatchKind(line, item) {
  const raw = line && line.batch_number !== undefined && line.batch_number !== null ? String(line.batch_number) : "";
  const it = item || {};
  if (Number(it.item_batch_management) === 1 && it.batch_number_genaration === IDA_AUTO_RULE && (raw === "" || raw === IDA_BATCH_PLACEHOLDER)) return "AUTO";
  const t = raw.trim();
  return t !== "" && t !== "-" && t !== IDA_BATCH_PLACEHOLDER ? "TYPED" : "NONE";
};
// grv2 batchKey: trimmed, lower-case (utf8mb4_general_ci compares case-insensitively and ignores trailing spaces)
const idaBatchKey = (n) => idaS(n).toLowerCase().replace(/ +$/, "");
// a batch number for SQL: the upper-case hex of its UTF-8 bytes, decoded by CONVERT(UNHEX(..) USING utf8mb4) (CONTRACT.md section 14.6)
const idaHex = function idaHex(text) {
  const t = text === undefined || text === null ? "" : String(text);
  let out = "";
  for (let i = 0; i < t.length; i++) {
    let c = t.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < t.length) {
      const d = t.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    const bytes = c < 0x80 ? [c] : c < 0x800 ? [0xc0 | (c >> 6), 0x80 | (c & 63)] : c < 0x10000 ? [0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)]
      : [0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)];
    for (const b of bytes) out += (b < 16 ? "0" : "") + b.toString(16).toUpperCase();
  }
  return out;
};
// the distinct non-blank numbers as one JSON text of hex strings (a blank number would match every blank Batch row)
const idaHexJson = (numbers) => {
  const seen = {};
  const out = [];
  for (const n of idaList(numbers)) {
    if (idaS(n) === "") continue;
    const h = idaHex(n);
    if (seen[h] !== true) {
      seen[h] = true;
      out.push(h);
    }
  }
  return JSON.stringify(out);
};
// code_batch_plan's genLine + the IDA's organization (the classic relies on the session global, empty in nested runs)
const idaBatchRequest = (header, line, organizationId) => ({
  item_id: idaS(line && line.item_selection),
  document_date: (header && header.item_disassembly_date) || null,
  manufacturing_date: (line && line.manufacturing_date) || null,
  expired_date: (line && line.expired_date) || null,
  organization_id: idaS(organizationId) || null,
});
// code_validate's line label: 'Line <i> (<item_name or item_selection or ->)', i 1-based in line order
const idaLineLabel = (i, line) => "Line " + i + " (" + ((line && (line.item_name || line.item_selection)) || "-") + ")";
const idaDbAddSeconds = function idaDbAddSeconds(text, seconds) {
  const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
const idaDbSeconds = function idaDbSeconds(a, b) {
  const t = (x) => {
    const m = String(x || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) : NaN;
  };
  return (t(b) - t(a)) / 1000;
};
// a COMMIT run's lease (GR V2 leaseFor): 10 min + 0.6 s per movement of both legs, at most 90 min
const idaLeaseSeconds = (n) => Math.min(5400, 600 + Math.ceil(0.6 * Math.max(0, Number(n) || 0)));
const IDA_PREV_STATUSES = ["Draft"];
const idaPrevStatusOk = (v) => IDA_PREV_STATUSES.indexOf(idaS(v)) >= 0;
const IDA_V2_MIN_MOVES = 50;
const IDA_CLASSIC_MAX_MOVES = 250;
const IDA_MAX_MOVES = 5000;
const IDA_PARK = 1000;
const IDA_LOCK_WAIT_TRIES = 8;
const IDA_RECEIPT_WAIT_S = 1800;
const IDA_RECEIPT_RETRY_S = 10;
const IDA_OK_CATEGORIES = ["Unrestricted", "Blocked"];
const IDA_OPEN_JOB = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_IDA", "REQUIRES_REVIEW"];
const IDA_RUNNING_JOB = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_IDA"];
const IDA_TERMINAL_JOB = ["COMPLETED", "FAILED", "REQUIRES_REVIEW", "CANCELLED", "NONE"];
const IDA_FINAL = ["Completed", "Fully Posted"];
const IDA_KEY_RE = /^[A-Za-z0-9|:_.-]{8,128}$/;
const idaLockJob = (idaId) => "IDC|" + idaS(idaId);
const idaCorrelation = (idaId) => "IDA|" + idaS(idaId);
const idaOpKey = (jobId, side) => "IDC|" + idaS(jobId) + "|" + (side === "R" ? "R" : "I");
const IDA_CHUNK = 400000;
const idaPartRows = function idaPartRows(jobId, organizationId, prefix, value, status) {
  const text = JSON.stringify(value);
  const out = [];
  for (let at = 0, n = 1; at < text.length || n === 1; at += IDA_CHUNK, n++) {
    out.push({ job_id: idaS(jobId), organization_id: idaS(organizationId), step_name: prefix + String(n).padStart(3, "0"), step_status: status || "PAYLOAD", attempt_count: 0,
      result_ref: text.slice(at, at + IDA_CHUNK) });
  }
  return out;
};
// null = no row, undefined = the joined text does not parse
const idaJoinChunks = function idaJoinChunks(rows, prefix) {
  const mine = idaList(rows).filter((r) => idaS(r.step_name).indexOf(prefix) === 0).sort((a, b) => (idaS(a.step_name) < idaS(b.step_name) ? -1 : 1));
  if (!mine.length) return null;
  const p = idaParseJ(mine.map((r) => (r.result_ref === undefined || r.result_ref === null ? "" : String(r.result_ref))).join(""));
  return p === null ? undefined : p;
};
// tpl/smv2 commit/_cmp.js sameVal / sameStored, bound to idaQ8
const idaSameVal = function idaSameVal(a, b) {
  const ea = a === undefined || a === null || a === "";
  const eb = b === undefined || b === null || b === "";
  if (ea || eb) return ea && eb;
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  const t = (v) => (/^-?[0-9]+\.[0-9]+$/.test(String(v)) ? String(v).replace(/0+$/, "").replace(/\.$/, "") : String(v));
  const ta = t(a);
  const tb = t(b);
  if (ta === tb) return true;
  const na = typeof a === "number" || /^-?[0-9]+(\.[0-9]+)?$/.test(ta);
  const nb = typeof b === "number" || /^-?[0-9]+(\.[0-9]+)?$/.test(tb);
  if (na && nb && !/^-?[0-9]{16,}$/.test(ta) && !/^-?[0-9]{16,}$/.test(tb)) return Math.abs(idaQ8(a) - idaQ8(b)) < 1e-8;
  return false;
};
const idaSameStored = function idaSameStored(computed, stored) {
  if (idaSameVal(computed, stored)) return true;
  if (typeof computed === "object" || computed === "" || computed === null || computed === undefined || stored === "" || stored === null || stored === undefined) return false;
  const a = Number(computed);
  const b = Number(stored);
  if (!isFinite(a) || !isFinite(b)) return false;
  for (let d = 0; d < 8; d++) {
    const f = Math.pow(10, d);
    const x = Number((a * f).toFixed(6));
    for (const c of [Math.sign(x) * Math.round(Math.abs(x)), Math.trunc(x), Math.sign(x) * Math.ceil(Math.abs(x))]) if (Math.abs(c / f - b) < 1e-9) return true;
  }
  return false;
};
// the texts several packages write (CONTRACT.md section 10)
const IDA_TEXT = {
  busy: "This Item Disassembly is being processed in the background - please wait for it to finish.",
  underReview: "Its last completion stopped half-way and is under review: please contact support.",
  stale: (status) => "This Item Disassembly was changed by someone else (it is now " + (idaS(status) || "without a status") + "). Please close it and open it again.",
  alreadyFinal: (status) => "This Item Disassembly is already " + idaS(status) + ".",
  classicFinal: (status) => "This Item Disassembly is already " + idaS(status) + " and cannot be saved again.",
  classicTooBig: (n, cap) => "This Item Disassembly has " + n + " source picks and recovery lines - too big for the classic save, which handles at most " + cap
    + " at once. Complete it from the web form with background completion switched on, or split it into smaller disassemblies.",
  tooBig: (n, reason, cap) => "This Item Disassembly has " + n + " source picks and recovery lines and cannot be completed in the background (" + idaS(reason)
    + "); the classic save handles at most " + cap + ".",
  splitRequired: (n, what) => "This Item Disassembly has " + n + " " + idaS(what) + ". At most 5,000 can be moved at once - please split the disassembly.",
  queueFailed: "The completion could not be queued: please try again.",
  notFound: "Item Disassembly not found - it may have been deleted.",
  unlinked: "The completion stopped before the Item Disassembly was linked to its job: please complete it again.",
  notLocked: "The Item Disassembly is no longer locked by this completion: nothing was moved.",
  linesChanged: "The Item Disassembly's lines changed while it was waiting: nothing was moved, please complete it again.",
  planFailed: (why) => "The completion could not be prepared: " + idaS(why),
  lockBusy: "The stock of the item being disassembled stayed locked by another operation: nothing was moved, please try again later.",
  batchDuplicate: (n) => "Duplicate Batch Format found. (batch number " + idaS(n) + ") Nothing was moved.",
  // code_validate's own wording (SUBMIT, F4 ruling); typedTaken adds what PREPARE / D1 know: nothing moved
  typedExists: (label, n) => idaS(label) + ": Batch No " + idaS(n) + " already exists.",
  typedTaken: (label, n) => idaS(label) + ": Batch No " + idaS(n) + " already exists. Nothing was moved.",
  batchFailed: (why) => "The Batch rows of the recovered items could not be created (" + idaS(why) + "): nothing was moved, please complete it again.",
  review: "Under review: the completion stopped half-way. Please contact support.",
  prevUnknown: "Under review: the status to restore is unknown. Please contact support.",
  notCompleted: "Temporary failures persisted; not completed.",
  postLater: "Still completing in the background; post it from the list once it shows Completed.",
  noJob: "no background save",
};
if (typeof module !== "undefined") module.exports = { idaS, idaQ8, idaQtyStr, idaDigits, idaIdStr, idaIdAfter, idaParseJ, idaList, idaJsonList, idaRows, idaIdsSql, idaTuples, idaCategory, idaPicks, idaPickCount, idaRecoveryLines, idaMoveCount, idaHasHu, idaPickHasSerial, IDA_AUTO_RULE, IDA_BATCH_PLACEHOLDER, idaBatchKind, idaBatchKey, idaHex, idaHexJson, idaBatchRequest, idaLineLabel, idaDbAddSeconds, idaDbSeconds, idaLeaseSeconds, IDA_PREV_STATUSES, idaPrevStatusOk, IDA_V2_MIN_MOVES, IDA_CLASSIC_MAX_MOVES, IDA_MAX_MOVES, IDA_PARK, IDA_LOCK_WAIT_TRIES, IDA_RECEIPT_WAIT_S, IDA_RECEIPT_RETRY_S, IDA_OK_CATEGORIES, IDA_OPEN_JOB, IDA_RUNNING_JOB, IDA_TERMINAL_JOB, IDA_FINAL, IDA_KEY_RE, idaLockJob, idaCorrelation, idaOpKey, IDA_CHUNK, idaPartRows, idaJoinChunks, idaSameVal, idaSameStored, IDA_TEXT };
