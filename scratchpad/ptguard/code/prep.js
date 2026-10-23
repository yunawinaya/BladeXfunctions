// Duplicate guard, step 1: what is being saved. A NEW transfer (pageStatus other than Edit) saved as Draft or Issued
// carries the app's pt_idem_key, honoured only from the app (pageStatus Add, no web "$_v": a web Copy sends the
// copied record's fields), and, for Issued, a fingerprint of tenant + user + plants + lines that catches the same
// content sent again within 15 minutes by app versions without a key and by the web.
// Also flags the edit-time checks (Draft on a stored transfer; the receiving child's twin read-back) and makes the
// per-run cache key that replaces the per-user generatedBatches_ / newSubFormData_ / finalSubFormData_ keys.
const KEY_RE = /^[A-Za-z0-9:_.-]{8,128}$/;
const allData = [{{workflowparams:allData}}][0] || {};
const saveAs = s([{{workflowparams:saveAs}}][0]);
const pageStatus = s([{{workflowparams:pageStatus}}][0]);
const tenantId = s([{{system:tenantId}}][0]);
const uid = s([{{system:uid}}][0]);
const runKey = (s([{{system:uuid}}][0]).replace(/[^0-9A-Za-z]/g, "") || Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 40);
const out = { route: "GO", code: "200", message: "", result_code: "", guardOn: "NO", isIssuedAdd: "NO", tenantId: isDigits(tenantId) ? tenantId : "0",
  keySql: "~none~", fpSql: "~none~", uuidSaving: "", uuidSaved: "", draftCheck: "NO", editId: "0", childCheck: "NO", parentId: "0", runKey: runKey };
const isNew = pageStatus !== "Edit" && (saveAs === "Draft" || saveAs === "Issued");
const fromWeb = Object.prototype.hasOwnProperty.call(allData, "$_v");
const key = s(allData.pt_idem_key);
const useKey = isNew && pageStatus === "Add" && !fromWeb && key !== "";
if (useKey && !KEY_RE.test(key)) {
  return Object.assign(out, { route: "INVALID", code: "400", result_code: "PT_IDEM_KEY_INVALID",
    message: "pt_idem_key must be 8-128 characters of A-Z a-z 0-9 : _ . -" });
}
if (out.tenantId === "0") return out;
let fp = "";
if (isNew && saveAs === "Issued" && uid !== "") {
  const lines = Array.isArray(allData.stock_movement) ? allData.stock_movement : [];
  const parts = lines.map((l) => {
    const qty = parseList(l.temp_qty_data).filter((e) => e && Number(e.sm_quantity) > 0)
      .map((e) => [s(e.material_id), s(e.batch_id), s(e.location_id), s(e.category), num8(e.sm_quantity)].join("~")).sort().join(",");
    const hu = parseList(l.temp_hu_data).filter((h) => h && Number(h.sm_quantity) > 0)
      .map((h) => [s(h.handling_unit_id), s(h.material_id), s(h.batch_id), s(h.location_id), num8(h.sm_quantity)].join("~")).sort().join(",");
    return [s(l.item_selection), s(l.batch_no), s(l.category), num8(l.total_quantity), s(l.quantity_uom), qty, hu].join("|");
  }).sort();
  const canon = [out.tenantId, uid, s(allData.organization_id), s(allData.issuing_operation_faci), s(allData.receiving_operation_faci), parts.join("\n")].join("\n");
  fp = "PTFP1." + fnv1a(canon) + djb2(canon) + "." + lines.length;
}
if (useKey || fp !== "") {
  const stored = (useKey ? key : "-") + "|" + (fp || "-") + "|";
  Object.assign(out, { guardOn: "YES", isIssuedAdd: isNew && saveAs === "Issued" ? "YES" : "NO", keySql: useKey ? key : "~none~", fpSql: fp || "~none~",
    uuidSaving: stored + "SAVING", uuidSaved: stored + "SAVED" });
}
if (pageStatus === "Edit" && saveAs === "Draft" && isDigits(allData.id)) Object.assign(out, { draftCheck: "YES", editId: s(allData.id) });
if (pageStatus === "Edit" && saveAs === "In Progress" && isDigits(allData.id)) Object.assign(out, { childCheck: "YES", parentId: s(allData.id) });
return out;
