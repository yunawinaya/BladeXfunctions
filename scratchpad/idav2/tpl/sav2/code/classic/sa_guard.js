//@include shared/sa_common.js
// SA V2 guard (CONTRACT §11): payload only - a completion of > 500 entries (sa_quantity > 0, as code_node_qrsgEz2F), or any
// balance_index > 60,000 UTF-8 bytes (prod truncates the TEXT column silently), is refused; odd shapes pass through.
const saGuardIn = { allData: [{{workflowparams:allData}}][0], saveAs: [{{workflowparams:saveAs}}][0], tenantId: [{{system:tenantId}}][0] };
let saGuardDoc = saGuardIn.allData;
if (typeof saGuardDoc === "string") saGuardDoc = saParseJ(saGuardDoc);
if (!saGuardDoc || typeof saGuardDoc !== "object" || Array.isArray(saGuardDoc)) saGuardDoc = {};
let saId = "0";
let tenantId = "0";
try {
  const t = saS(saGuardIn.tenantId);
  const id = saIdStr(saGuardDoc.id);
  if (saDigits(t) && saDigits(id)) {
    saId = id;
    tenantId = t;
  }
} catch (e) {
  saId = "0";
  tenantId = "0";
}
let entries = 0;
let reason = "";
let message = "";
try {
  let large = null;
  const lines = Array.isArray(saGuardDoc.stock_adjustment) ? saGuardDoc.stock_adjustment : [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || typeof line !== "object") continue;
    const bytes = saUtf8Bytes(line.balance_index);
    if (!large && bytes > SA_LINE_MAX_BYTES) large = { line: i + 1, bytes: bytes };
    for (const e of saJsonList(line.balance_index)) if (e && typeof e === "object" && e.sa_quantity > 0) entries++;
  }
  const saveAs = saGuardIn.saveAs === undefined || saGuardIn.saveAs === null ? "" : String(saGuardIn.saveAs);
  if (saveAs !== "Draft" && entries > SA_CLASSIC_MAX_ENTRIES) {
    reason = "SA_CLASSIC_TOO_BIG";
    message = "This Stock Adjustment has " + entries + " entries. Adjust at most " + SA_CLASSIC_MAX_ENTRIES + " at a time.";
  } else if (large) {
    reason = "SA_LINE_TOO_LARGE";
    message = "Line " + large.line + " holds too many bins (" + large.bytes + " bytes); split it into several lines.";
  }
} catch (e) {
  reason = "";
  message = "";
}
return { saId: saId, tenantId: tenantId, entries: String(entries), reason: reason, message: message };
