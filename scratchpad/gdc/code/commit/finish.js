// GD_COMPLETE_COMMIT - FINISH: C6 done and the job COMPLETED; an auto-SI that did not invoice is reported on the job
// (the completion stands, as the old path's headless auto-SI)
const commitFinish = function commitFinish(entry, c6, si) {
  const called = s(c6.needSi) === "YES";
  const skipped = Number(si.skipped) === 1;
  const siFailed = called && !(s(si.code) === "200" || skipped);
  const message = "Goods Delivery " + s(entry.gdNo) + " completed" + (called && s(si.si_no) ? "; Sales Invoice " + s(si.si_no) : "");
  return {
    stepRows: [doneRow(entry, "C6_AFTER", called ? "SI " + (siFailed ? "failed: " + s(si.message) : s(si.si_no) || "skipped") : "no SI")],
    jobRows: [jobRow(entry, { job_status: "COMPLETED", progress_percent: 100, progress_message: message.slice(0, 250), error_code: siFailed ? "GDC_AUTO_SI_FAILED" : null,
      error_message: siFailed ? "The delivery was completed, but the Sales Invoice could not be created automatically: " + s(si.message) : null,
      error_details: siFailed ? JSON.stringify({ step: "C6_SI", code: s(si.code), message: s(si.message) }) : null, finished_at: entry.dbNow })],
    result_message: message, siFailed: siFailed ? 1 : 0,
  };
};
const si = { code: [{{node:workflow_node_CCc6si.data.code}}][0], message: [{{node:workflow_node_CCc6si.data.message}}][0], skipped: [{{node:workflow_node_CCc6si.data.skipped}}][0], si_no: [{{node:workflow_node_CCc6si.data.si_no}}][0] };
const res = commitFinish([{{node:code_node_CCentry.data}}][0], [{{node:code_node_CCc6.data}}][0], si);
console.log("commit finish", JSON.stringify({ message: res.result_message, siFailed: res.siFailed }));
return res;
