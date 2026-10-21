// IDA_V2_COMMIT - D0 REVALIDATE (nothing moved yet): the stored header still Processing under this job (the entry checked the lock key
// in this pass), its number the plan's, and idaLineFingerprint(stored lines, stored header) the plan's -> DONE (ref = the fingerprint);
// else FAILED + the IDA back to Draft
const commitD0 = function commitD0(entry, headerRows, lineRows) {
  const h = idaRows(headerRows)[0] || null;
  const oursRead = entry.needBatchRead === "YES" && entry.hasIntent === "YES" ? "YES" : "NO";
  const fail = (code, message, why) => {
    const f = failNoWrite(entry, code, message, why, []);
    return Object.assign(f, { needOursRead: f.job_status === "FAILED" ? oursRead : "NO" });
  };
  if (!h) return fail("IDA_NOT_LOCKED", IDA_TEXT.notLocked, "the Item Disassembly is missing (deleted?): nothing was moved");
  if (s(h.item_disassembly_status) !== "Processing" || s(h.ida_v2_job_id) !== entry.jobId) {
    return fail("IDA_NOT_LOCKED", IDA_TEXT.notLocked, "the Item Disassembly is " + (s(h.item_disassembly_status) || "without a status") + " under job " + (s(h.ida_v2_job_id) || "(none)") + ": nothing was moved");
  }
  if (s(h.stock_movement_no) !== entry.idaNo) return fail("IDA_LINES_CHANGED", IDA_TEXT.linesChanged, "the Item Disassembly's number is " + s(h.stock_movement_no) + ", the plan's is " + entry.idaNo + ": nothing was moved");
  const fp = idaLineFingerprint(lineRows, headerRows);
  if (fp !== entry.lineFingerprint) return fail("IDA_LINES_CHANGED", IDA_TEXT.linesChanged, "the stored lines are " + fp + ", the plan expects " + entry.lineFingerprint + ": nothing was moved");
  return stepOk(entry, "D0_REVALIDATE", fp, "revalidated");
};
const res = commitD0([{{node:code_node_DCentry.data}}][0], [{{node:sql_node_DCd0hdr.data}}][0], [{{node:sql_node_DCd0lines.data}}][0]);
console.log("commit D0", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
