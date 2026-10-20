// PICKING_ASYNC_WORKER - Publish gate: PWmid's PUBLISH, or (Picking 1d) a force complete whose drive in THIS iteration ended
// with every delivery updated. The after-drive node ran in this iteration only when PWmid said DRIVE: it is read only then
const workerGo = function workerGo(mid, after) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const m = mid || {};
  const drove = s(m.route) === "DRIVE" && after && typeof after === "object";
  const go = s(m.route) === "PUBLISH" || (drove && s(after.route) === "PUBLISH");
  return { route: go ? "PUBLISH" : "END", dbNow: drove ? s(after.dbNow) || s(m.dbNow) : s(m.dbNow), jobId: s(m.jobId), jobStatus: drove ? s(after.jobStatus) : s(m.jobStatus),
    result_message: go ? (drove ? "publish after the drive" : s(m.result_message)) : drove ? "the drive is not done: no publish call" : s(m.result_message) };
};
const mid = [{{node:code_node_PWmid.data}}][0];
const res = workerGo(mid, mid && mid.route === "DRIVE" ? [{{node:code_node_PWdriveAfter.data}}][0] : null);
console.log("worker go", JSON.stringify(res));
return res;
