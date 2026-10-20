// SM V2 guard: a Location Transfer a background save holds is Processing (refused below); more than 500 flat lines is
// refused unless saved as Draft. Flat lines = the classic's flatLines (code_node_yPlLXIZW: bundle parents excluded).
const a = [{{workflowparams:allData}}][0] || {};
const saveAs = String([{{workflowparams:saveAs}}][0] || "");
const tenantId = String([{{system:tenantId}}][0] || "").trim();
const rawId = a && typeof a === "object" ? a.id : null;
// an unsafe 19-digit NUMBER is not the stored id: no stored read (the classic's own writes would miss it too)
const id = typeof rawId === "number" ? (Number.isSafeInteger(rawId) && rawId >= 0 ? String(rawId) : "") : String(rawId === undefined || rawId === null ? "" : rawId).trim();
const digits = (v) => /^[0-9]{1,20}$/.test(v);
const isBundleParent = (row) => Boolean(row.item_bundle_id && !row.parent_fm_key && !/^[1-9][0-9]*$/.test(String(row.parent_id == null ? "" : row.parent_id)));
let payloadLines = 0;
for (const row of Array.isArray(a.stock_movement) ? a.stock_movement : []) {
  if (!row || typeof row !== "object") continue;
  if (!isBundleParent(row)) payloadLines++;
  for (const child of Array.isArray(row.children) ? row.children : []) {
    if (child && typeof child === "object" && !isBundleParent(child)) payloadLines++;
  }
}
const check = digits(id) && digits(tenantId);
const big = !check && saveAs !== "Draft" && payloadLines > 500;
return {
  check: check ? "YES" : "NO",
  lotId: check ? id : "0",
  tenantId: check ? tenantId : "0",
  saveAs: saveAs,
  payloadLines: payloadLines,
  bigNoRead: big ? "YES" : "NO",
  bigMessage: "This Location Transfer has " + payloadLines + " lines. A save of more than 500 lines is not supported here - please split it into smaller transfers.",
};
