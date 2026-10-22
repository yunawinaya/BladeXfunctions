//@include shared/sa_common.js
// SA V2 guard (CONTRACT §11): payload only - a completion of > 500 entries (sa_quantity > 0, as code_node_qrsgEz2F), or any
// balance_index > 60,000 UTF-8 bytes (prod truncates the TEXT column silently), or a moving entry in Reserved (another document holds
// that stock: an Item Assembly hold, a GD / SO reservation), is refused; odd shapes pass through. A non-Draft save also lists the
// engine lock keys its movements would touch (ITEM / BATCH / COST, as INVENTORY_BULK_APPLY builds them) for the verdict's held-lock check.
const saGuardIn = { allData: [{{workflowparams:allData}}][0], saveAs: [{{workflowparams:saveAs}}][0], tenantId: [{{system:tenantId}}][0] };
let saGuardDoc = saGuardIn.allData;
if (typeof saGuardDoc === "string") saGuardDoc = saParseJ(saGuardDoc);
if (!saGuardDoc || typeof saGuardDoc !== "object" || Array.isArray(saGuardDoc)) saGuardDoc = {};
let saId = "0";
let tenantId = "0";
let lockTenantId = "0";
try {
  const t = saS(saGuardIn.tenantId);
  const id = saIdStr(saGuardDoc.id);
  if (saDigits(t)) lockTenantId = t;
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
const lockKeys = {};
try {
  let large = null;
  let reserved = 0;
  const saveAs = saGuardIn.saveAs === undefined || saGuardIn.saveAs === null ? "" : String(saGuardIn.saveAs);
  const headerPlant = saIdStr(saGuardDoc.plant_id);
  const lines = Array.isArray(saGuardDoc.stock_adjustment) ? saGuardDoc.stock_adjustment : [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || typeof line !== "object") continue;
    const bytes = saUtf8Bytes(line.balance_index);
    if (!large && bytes > SA_LINE_MAX_BYTES) large = { line: i + 1, bytes: bytes };
    for (const e of saJsonList(line.balance_index)) {
      if (!e || typeof e !== "object" || !(e.sa_quantity > 0)) continue;
      entries++;
      if (!reserved && saS(e.category).trim().toLowerCase() === "reserved") reserved = i + 1;
      const mat = saIdStr(line.material_id);
      const loc = saIdStr(e.location_id);
      if (saveAs === "Draft" || !mat || !loc) continue;
      const plant = saIdStr(e.plant_id) || headerPlant;
      const batch = saIdStr(e.batch_id);
      lockKeys["ITEM|" + mat + "|" + loc] = true;
      if (plant) lockKeys["COST|" + mat + "|" + plant] = true;
      if (batch) lockKeys["BATCH|" + mat + "|" + loc + "|" + batch] = true;
    }
  }
  if (saveAs !== "Draft" && entries > SA_CLASSIC_MAX_ENTRIES) {
    reason = "SA_CLASSIC_TOO_BIG";
    message = "This Stock Adjustment has " + entries + " entries. Adjust at most " + SA_CLASSIC_MAX_ENTRIES + " at a time.";
  } else if (saveAs !== "Draft" && reserved) {
    reason = "SA_RESERVED";
    message = "Line " + reserved + ": Reserved stock belongs to another document. Release it there first.";
  } else if (large) {
    reason = "SA_LINE_TOO_LARGE";
    message = "Line " + large.line + " holds too many bins (" + large.bytes + " bytes); split it into several lines.";
  }
} catch (e) {
  reason = "";
  message = "";
}
const orgId = saIdStr(saGuardDoc.organization_id) || "0";
const keyList = lockTenantId !== "0" && orgId !== "0" ? Object.keys(lockKeys).sort() : [];
return { saId: saId, tenantId: tenantId, lockTenantId: lockTenantId, orgId: orgId, lockKeysJson: JSON.stringify(keyList), entries: String(entries), reason: reason,
  message: message };
