//@include shared/sa_common.js
// SC guard (CONTRACT §11): reads only allData.id / .table_stock_count, saveAs and createAdjustment (mobile's pageStatus is an
// object); a Review that would build an SA (code_review_prep's own predicates) of > 500 lines with a variance is refused.
const scGuardIn = { allData: [{{workflowparams:allData}}][0], saveAs: [{{workflowparams:saveAs}}][0],
  createAdjustment: [{{workflowparams:createAdjustment}}][0], tenantId: [{{system:tenantId}}][0] };
let scGuardDoc = scGuardIn.allData;
if (typeof scGuardDoc === "string") scGuardDoc = saParseJ(scGuardDoc);
if (!scGuardDoc || typeof scGuardDoc !== "object" || Array.isArray(scGuardDoc)) scGuardDoc = {};
let scId = "0";
let tenantId = "0";
try {
  const t = saS(scGuardIn.tenantId);
  const id = saIdStr(scGuardDoc.id);
  if (saDigits(t) && saDigits(id)) {
    scId = id;
    tenantId = t;
  }
} catch (e) {
  scId = "0";
  tenantId = "0";
}
let reviewLines = 0;
let buildsSa = false;
let reason = "";
let message = "";
try {
  const lines = (Array.isArray(scGuardDoc.table_stock_count) ? scGuardDoc.table_stock_count : []).filter((item) => item && typeof item === "object" && item.line_status !== "Cancel");
  const allApproved = lines.every((item) => item.line_status === "Approved" || item.line_status === "Adjusted");
  const approvedItems = lines.filter((item) => item.review_status === "Approved" && item.line_status !== "Adjusted");
  const itemsWithVariance = approvedItems.filter((item) => item.variance_qty !== 0 && item.line_status === "Approved");
  buildsSa = approvedItems.length > 0 && (allApproved || scGuardIn.createAdjustment === "Yes");
  reviewLines = itemsWithVariance.length;
  const saveAs = scGuardIn.saveAs === undefined || scGuardIn.saveAs === null ? "" : String(scGuardIn.saveAs);
  if (saveAs === "Review" && buildsSa && reviewLines > SA_CLASSIC_MAX_ENTRIES) {
    reason = "SA_CLASSIC_TOO_BIG";
    message = "This review has " + reviewLines + " approved lines with a variance. Review at most " + SA_CLASSIC_MAX_ENTRIES + " lines at a time.";
  }
} catch (e) {
  reason = "";
  message = "";
}
return { scId: scId, tenantId: tenantId, reviewLines: String(reviewLines), buildsSa: buildsSa ? "YES" : "NO", reason: reason, message: message };
