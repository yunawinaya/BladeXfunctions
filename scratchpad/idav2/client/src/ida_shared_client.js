// client copies of code/shared/ida_common.js (CONTRACT section 6); test_json_integrity.js keeps them identical
const idaS = (v) => (v === undefined || v === null ? "" : String(v)).trim();
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
const idaPicks = (header) => idaJsonList(header && header.temp_qty_data).filter((p) => p && typeof p === "object" && (parseFloat(p.sm_quantity) || 0) > 0);
const idaPickCount = (header) => idaPicks(header).length;
const idaRecoveryLines = (lines) => idaList(lines).filter((l) => l && typeof l === "object" && idaS(l.item_selection) !== "");
const idaMoveCount = (header, lines) => idaPickCount(header) + idaRecoveryLines(lines).length;
const idaHasHu = (header) => {
  const h = header || {};
  return idaJsonList(h.temp_qty_data).some((p) => p && typeof p === "object" && idaS(p.handling_unit_id) !== "")
    || idaJsonList(h.temp_hu_data).length > 0 || idaJsonList(h.table_hu).length > 0;
};
const idaPickHasSerial = (header) => idaJsonList(header && header.temp_qty_data).some((p) => p && typeof p === "object" && idaS(p.serial_number) !== "");
const IDA_V2_MIN_MOVES = 50;
const IDA_TEXT = {
  busy: "This Item Disassembly is being processed in the background - please wait for it to finish.",
  queueFailed: "The completion could not be queued: please try again.",
  postLater: "Still completing in the background; post it from the list once it shows Completed.",
};
