// IA_V2_COMMIT - I0 REVALIDATE (nothing moved yet): the stored header still Processing under this job (the entry checked the
// lock key in this pass), its number the plan's, and iaLineFingerprint(stored lines, stored header) the plan's -> DONE;
// else FAILED + the IA back to Draft
const commitI0 = function commitI0(entry, headerRows, lineRows) {
  const h = iaRows(headerRows)[0] || null;
  const ours = entry.batchId ? [entry.batchId] : [];
  if (!h) return failNoWrite(entry, "IA_NOT_LOCKED", IA_TEXT.notLocked, "the Item Assembly is missing (deleted?): no stock was moved", ours);
  if (s(h.item_assembly_status) !== "Processing" || s(h.ia_v2_job_id) !== entry.jobId) {
    return failNoWrite(entry, "IA_NOT_LOCKED", IA_TEXT.notLocked, "the Item Assembly is " + (s(h.item_assembly_status) || "without a status") + " under job " + (s(h.ia_v2_job_id) || "(none)") + ": no stock was moved", ours);
  }
  if (s(h.stock_movement_no) !== entry.iaNo) return failNoWrite(entry, "IA_LINES_CHANGED", IA_TEXT.linesChanged, "the Item Assembly's number is " + s(h.stock_movement_no) + ", the plan's is " + entry.iaNo + ": no stock was moved", ours);
  const fp = iaLineFingerprint(lineRows, headerRows);
  if (fp !== entry.lineFingerprint) return failNoWrite(entry, "IA_LINES_CHANGED", IA_TEXT.linesChanged, "the stored lines are " + fp + ", the plan expects " + entry.lineFingerprint + ": no stock was moved", ours);
  return stepOk(entry, "I0_REVALIDATE", fp, "revalidated");
};
const res = commitI0([{{node:code_node_IACentry.data}}][0], [{{node:sql_node_IACi0hdr.data}}][0], [{{node:sql_node_IACi0lines.data}}][0]);
console.log("commit I0", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
