// Stock Movement V2: with CANCEL switched on, each In Progress transfer goes to LOT_V2_SUBMIT (CANCEL, ids only). A
// NOT_ELIGIBLE (incl. <= V2_MIN_LINES stored lines) / INVALID / no usable answer, or an error before SUBMIT, runs the classic cancel.
const LOT_WF = {
  SUBMIT: "__LOT_V2_SUBMIT__", // LOT_V2_SUBMIT
  WORKER: "__LOT_V2_WORKER__", // LOT_V2_WORKER
};
// Switches: ASYNC_LOT_ENABLED false or LOT_V2_CANCEL false = every cancel runs the classic workflow
const ASYNC_LOT_ENABLED = true;
const LOT_V2_CANCEL = true;
const V2_MIN_LINES = 50;
const LOT_RUNNING = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_LOT"];
const LOT_TERMINAL = ["COMPLETED", "FAILED", "REQUIRES_REVIEW", "CANCELLED"];
const LOT_ROUTES = ["QUEUED", "SAVED", "STATUS", "NOT_ELIGIBLE", "BUSY", "STALE", "STOP", "INVALID"];

const lotV2Queued = [];
const lv2s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const lv2run = (id, params) =>
  new Promise((resolve, reject) => {
    this.runWorkflow(id, params, (res) => resolve(res), (err) => reject(err));
  });

// one key per click and transfer: a lost answer re-sent with the same key finds the same job
const lotV2ClickToken = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const lotV2KeyOf = (lot) => ("LOT:" + lv2s(lot.organization_id) + ":" + lv2s(lot.id) + ":" + lotV2ClickToken).replace(/[^A-Za-z0-9|:_.-]/g, "-").slice(0, 128);

// { kind: "CLASSIC" } (the classic cancel runs), "QUEUED" (a background cancel), "DONE" (already cancelled) or "FAILED" + reason
const lotV2Cancel = async (lot) => {
  let params = null;
  try {
    if (ASYNC_LOT_ENABLED !== true || LOT_V2_CANCEL !== true || LOT_WF.SUBMIT === "0" || LOT_WF.WORKER === "0" || !/^[0-9]{1,20}$/.test(lv2s(lot.id))) {
      return { kind: "CLASSIC" };
    }
    params = {
      operation: "SUBMIT",
      saveAs: "Cancelled",
      pageStatus: "Edit",
      lot_id: lv2s(lot.id),
      idempotency_key: lotV2KeyOf(lot),
      source: "LIST",
      min_lines: String(V2_MIN_LINES),
      form: { id: lv2s(lot.id), stock_movement_status: lv2s(lot.stock_movement_status), stock_movement_no: lv2s(lot.stock_movement_no), organization_id: lv2s(lot.organization_id) },
    };
  } catch (error) {
    console.error("Location Transfer V2: cancel not sent - classic cancel", error);
    return { kind: "CLASSIC" };
  }
  let res = null;
  try {
    res = await lv2run(LOT_WF.SUBMIT, params);
  } catch (error) {
    // the losing twin of the unique insert, a dropped connection: once more with the same key
    try {
      res = await lv2run(LOT_WF.SUBMIT, params);
    } catch (again) {
      // the classic refuses a transfer SUBMIT already made Processing
      console.error(`No response from the background cancel for ${lot.stock_movement_no} - classic cancel`, again);
      return { kind: "CLASSIC" };
    }
  }
  const r = (res && res.data) || {};
  const st = lv2s(r.job_status);
  if (LOT_ROUTES.indexOf(lv2s(r.route)) < 0) {
    console.error(`No usable answer from the background cancel for ${lot.stock_movement_no} - classic cancel`, res);
    return { kind: "CLASSIC" };
  }
  if (r.route === "NOT_ELIGIBLE" || r.route === "INVALID") return { kind: "CLASSIC" };
  if (r.route === "QUEUED" || (r.route === "STATUS" && LOT_RUNNING.indexOf(st) >= 0)) {
    lotV2Queued.push({ jobId: lv2s(r.job_id), no: lv2s(lot.stock_movement_no) });
    return { kind: "QUEUED" };
  }
  if (r.route === "STATUS" && st === "COMPLETED") return { kind: "DONE" };
  const reason = lv2s(r.error_message) || lv2s(r.message) || lv2s(r.route) || "no response";
  console.error(`Failed to cancel ${lot.stock_movement_no}: ${reason}`);
  return { kind: "FAILED", reason: reason };
};

// the queued cancels, one after another: LOT_V2_WORKER per job until it ends (at most 10 calls each)
const lotV2Kick = async () => {
  for (const q of lotV2Queued) {
    for (let n = 1; n <= 10; n++) {
      let w = null;
      try {
        const res = await lv2run(LOT_WF.WORKER, { job_id: q.jobId });
        w = (res && res.data) || null;
      } catch (error) {
        console.error("Location Transfer V2: worker call failed - the list starts it again", error);
      }
      const st = w && lv2s(w.job_id) === q.jobId ? lv2s(w.job_status) : "";
      if (LOT_TERMINAL.indexOf(st) >= 0) {
        this.refresh();
        if (st !== "COMPLETED") this.$message.warning(`${q.no}: the background cancel did not finish - ${lv2s(w.result_message) || st}`);
        break;
      }
      if (!(Number((w && w.processed) || 0) > 0)) await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
};

