// GD_REVERT_COMMIT - FINISH: every step done (R4 put the delivery back to Created) -> the job COMPLETED, lease released
const revertFinish = function revertFinish(entry) {
  const m = entry.manifest || {};
  const message = "Goods Delivery " + s(entry.gdNo || m.gd_no) + " reverted: back to Created";
  return { jobRows: [jobRow(entry, { job_status: "COMPLETED", progress_percent: 100, progress_message: message, finished_at: endNow(entry) })], result_message: message, job_status: "COMPLETED" };
};
