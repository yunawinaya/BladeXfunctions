// Force Complete - bulk action on the Goods Delivery flow Picking list (event lkaac27r).
//
// Picking V2 stage 1d (2026-10-20): each selected In Progress Picking is force completed in the background
// (PICKING_ASYNC_SUBMIT, operation FORCE_COMPLETE). Its deliveries are reduced to what was picked - unpicked lines removed,
// their reserved stock released, the sales order given the quantity back - and then the Picking is completed. Every job is
// followed here: STATUS every 3 s; each delivery edit STATUS names in `kick` runs with GD_EDIT_WORKER in its own request,
// then the worker is kicked again; a re-kick every 15 s; up to 180 s. NOT_ELIGIBLE (Full Picking, Auto Complete GD, Loading
// Bay, Picking Plan pickings, deliveries with serial items, select picking or internal trading) runs today's classic force
// complete when the classic path takes its size (classic_ok 1). The switch off: the classic force complete for every Picking,
// as before (Bulk Actions/Warehouse Management/Picking/ForceCompleteWorkflow.js). The workflow ids are dev ids.
const PK_FC_WF = {
  SUBMIT: "2109531449614647297", // PICKING_ASYNC_SUBMIT
  WORKER: "2109531412499251201", // PICKING_ASYNC_WORKER
  GD_EDIT_WORKER: "2110618789356687361", // GD_EDIT_WORKER
  LOOP: "2021065804251615233", // PICKING_LOOP (the classic force complete)
};
// on together with PICKING_ASYNC_SUBMIT's STAGE.FORCE_COMPLETE (off: the dialog would promise what classic does not do)
const ASYNC_FORCE_COMPLETE_ENABLED = true;
const PK_FC_POLL_MS = 3000;
const PK_FC_KICK_MS = 15000;
// followed while it moves: stop after this long without progress, and after PK_FC_MAX_MS in all
const PK_FC_IDLE_MS = 180000;
const PK_FC_MAX_MS = 900000;

const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fcOn = () => ASYNC_FORCE_COMPLETE_ENABLED === true && Object.values(PK_FC_WF).every((id) => /^[1-9][0-9]{0,19}$/.test(id));

const pkFcCall = (workflowId, params) =>
  new Promise((resolve) => {
    try {
      this.runWorkflow(
        workflowId,
        params,
        (res) => resolve(res && res.data ? { ok: true, data: res.data } : { ok: false, error: "the answer carries no data" }),
        (err) => resolve({ ok: false, error: (err && (err.message || err.msg)) || String(err) }),
      );
    } catch (e) {
      resolve({ ok: false, error: e.message || String(e) });
    }
  });

// fire-and-forget; `then` runs once the call has answered (or failed)
const pkFcKick = (workflowId, params, then) => {
  const after = () => {
    if (then) then();
  };
  try {
    this.runWorkflow(workflowId, params, after, (e) => {
      console.error("Picking V2: " + workflowId + " kick failed", e);
      after();
    });
  } catch (e) {
    console.error("Picking V2: " + workflowId + " could not be kicked", e);
    after();
  }
};

const runPickingWorkflow = async (data) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      PK_FC_WF.LOOP,
      {
        arrayData: data,
        saveAs: "Completed",
        pageStatus: "Edit",
        isForceComplete: 1,
      },
      (res) => {
        console.log("Picking workflow response:", res);
        resolve(res);
      },
      (err) => {
        console.error("Failed to force complete Picking:", err);
        reject(err);
      },
    );
  });
};

// today's classic force complete of one Picking (PICKING_LOOP isForceComplete 1), its answer as a result row
const classicForceComplete = async (pickingItem) => {
  const data = await db.collection("transfer_order").doc(pickingItem.id).get();
  if (!data.data || data.data.length === 0) return { to_id: pickingItem.to_id, success: false, error: "Picking record not found" };
  try {
    const workflowResult = await runPickingWorkflow(data.data);
    if (!workflowResult || !workflowResult.data) return { to_id: pickingItem.to_id, success: false, error: "No response from workflow" };
    const resultCode = String(workflowResult.data.code);
    // Credit limit (402, 403) / packing not completed (407): the Picking completed, the GD was not auto-completed
    if (resultCode === "402" || resultCode === "403") return { to_id: pickingItem.to_id, success: true, warning: "Credit Limit - GD not auto-completed" };
    if (resultCode === "407") return { to_id: pickingItem.to_id, success: true, warning: "Packing not completed - GD not auto-completed" };
    if (resultCode === "400" || workflowResult.data.success === false) {
      return { to_id: pickingItem.to_id, success: false, error: workflowResult.data.msg || workflowResult.data.message || "Failed to force complete Picking" };
    }
    if (resultCode === "200" || workflowResult.data.success === true) return { to_id: pickingItem.to_id, success: true };
    return { to_id: pickingItem.to_id, success: false, error: "Unknown workflow status" };
  } catch (error) {
    return { to_id: pickingItem.to_id, success: false, error: error.message || "Failed to force complete" };
  }
};

// follow every queued job until it ends, makes no progress for PK_FC_IDLE_MS, or PK_FC_MAX_MS passes; result rows settle in place
const followJobs = async (jobs) => {
  const running = {};
  const seen = {};
  const start = Date.now();
  let lastChange = Date.now();
  let kickedAt = Date.now();
  for (const j of jobs) pkFcKick(PK_FC_WF.WORKER, { job_id: j.jobId });
  while (jobs.some((j) => !j.done) && Date.now() - lastChange < PK_FC_IDLE_MS && Date.now() - start < PK_FC_MAX_MS) {
    await sleep(PK_FC_POLL_MS);
    // a delivery edit still running after the pause (a big commit can take minutes) is progress too
    if (Object.keys(running).length) lastChange = Date.now();
    const rekick = Date.now() - kickedAt >= PK_FC_KICK_MS;
    if (rekick) kickedAt = Date.now();
    for (const j of jobs.filter((x) => !x.done)) {
      const res = await pkFcCall(PK_FC_WF.SUBMIT, { picking_id: j.pickingId, organization_id: j.organizationId, operation: "STATUS" });
      const st = res.ok ? res.data : null;
      if (!st || s(st.job_id) !== j.jobId) {
        if (rekick) pkFcKick(PK_FC_WF.WORKER, { job_id: j.jobId });
        continue;
      }
      const js = s(st.job_status);
      const why = s(st.result_message);
      const sign = [js, why, s(st.progress_percent), (Array.isArray(st.kick) ? st.kick : []).join(",")].join("|");
      if (seen[j.jobId] !== sign) {
        seen[j.jobId] = sign;
        lastChange = Date.now();
      }
      if (js === "COMPLETED") {
        Object.assign(j.row, { success: true, message: why || j.row.to_id + " force completed" });
        j.done = true;
      } else if (js === "FAILED" || js === "CANCELLED") {
        Object.assign(j.row, { success: false, error: /nothing was saved/i.test(why) ? why : "nothing was saved: " + (why || js) });
        j.done = true;
      } else if (js === "REQUIRES_REVIEW") {
        Object.assign(j.row, { success: false, error: "stopped half-way and is under review: please contact support" + (why ? " (" + why + ")" : "") });
        j.done = true;
      } else {
        this.showLoading(j.row.to_id + ": " + (why || "Force completing in the background"));
        // each delivery edit in its own request; when it answers, the force complete takes its next step
        for (const id of Array.isArray(st.kick) ? st.kick.map(s).filter(Boolean) : []) {
          if (running[id]) continue;
          running[id] = true;
          pkFcKick(PK_FC_WF.GD_EDIT_WORKER, { job_id: id }, () => {
            delete running[id];
            pkFcKick(PK_FC_WF.WORKER, { job_id: j.jobId });
          });
        }
        if (rekick) pkFcKick(PK_FC_WF.WORKER, { job_id: j.jobId });
      }
    }
  }
  for (const j of jobs.filter((x) => !x.done)) {
    Object.assign(j.row, { success: true, pending: true, message: j.row.to_id + ": still being saved in the background: keep this list open, or open it again, to let it finish" });
  }
};

(async () => {
  try {
    this.showLoading();
    const allListID = "custom_41s73hyl";

    const selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (!selectedRecords || selectedRecords.length === 0) {
      this.hideLoading();
      this.$message.error("Please select at least one record.");
      return;
    }

    // Filter for In Progress pickings only
    const pickingData = selectedRecords.filter((item) => item.to_status === "In Progress");
    const skipped = selectedRecords.filter((item) => item.to_status !== "In Progress").map((item) => item.to_id);

    if (pickingData.length === 0) {
      this.$message.error("Please select at least one in progress picking.");
      this.hideLoading();
      return;
    }

    const pickingNumbers = pickingData.map((item) => item.to_id);
    const v2 = fcOn();
    const confirmText = v2
      ? `You've selected ${pickingNumbers.length} picking(s) to force complete: ${pickingNumbers.join(", ")}.<br><br>Each picking is closed with what has already been picked:<br>` +
        "- every delivery line is reduced to its picked quantity, taken from the picked bins, batches and handling units;<br>" +
        "- lines with nothing picked are removed from the delivery;<br>" +
        "- the reserved stock of the unpicked quantity is released;<br>" +
        "- the sales order gets that quantity back as open.<br><br>This runs in the background. Proceed?"
      : `You've selected ${pickingNumbers.length} picking(s) to force complete. <br> <strong>Picking Numbers:</strong> <br>${pickingNumbers.join(", ")} <br><br><strong>Warning:</strong> Force completing will mark all remaining items as completed and reduce GD quantities to match picked quantities.<br><br>Do you want to proceed?`;

    await this.$confirm(confirmText, "Picking Force Completion", {
      confirmButtonText: "Proceed",
      cancelButtonText: "Cancel",
      type: "warning",
      dangerouslyUseHTMLString: true,
    }).catch(() => {
      console.log("User clicked Cancel or closed the dialog");
      throw new Error();
    });

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") organizationId = this.getVarSystem("deptIds").split(",")[0];

    const results = [];
    const jobs = [];

    for (const pickingItem of pickingData) {
      if (!v2) {
        results.push(await classicForceComplete(pickingItem));
        continue;
      }
      // one key per click and Picking, reused on the retry
      const key = "PKF-" + pickingItem.id + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const params = { picking_id: String(pickingItem.id), organization_id: String(pickingItem.organization_id || organizationId), operation: "FORCE_COMPLETE",
        idempotency_key: key, payload: "{}", confirmed_by: this.getVarGlobal("nickname") || "" };
      let sub = await pkFcCall(PK_FC_WF.SUBMIT, params);
      if (!sub.ok) sub = await pkFcCall(PK_FC_WF.SUBMIT, params);
      if (!sub.ok) {
        results.push({ to_id: pickingItem.to_id, success: false, error: "The force complete request did not complete (" + sub.error + ")" });
        continue;
      }
      const route = s(sub.data.route);
      if (route === "NOT_ELIGIBLE") {
        if (s(sub.data.classic_ok) === "1") {
          const r = await classicForceComplete(pickingItem);
          // the dialog described the background force complete: say this one was the classic one
          if (r.success && !r.warning) r.message = `${pickingItem.to_id}: completed by the classic force complete (${s(sub.data.result_message)}): the sales order was not given the unpicked quantity back`;
          results.push(r);
        } else results.push({ to_id: pickingItem.to_id, success: false, error: s(sub.data.result_message) || "This Picking cannot be force completed" });
        continue;
      }
      if (s(sub.data.result_code) === "200" && s(sub.data.job_id)) {
        const row = { to_id: pickingItem.to_id, success: false };
        results.push(row);
        jobs.push({ row: row, jobId: s(sub.data.job_id), pickingId: params.picking_id, organizationId: params.organization_id, done: false });
        continue;
      }
      results.push({ to_id: pickingItem.to_id, success: false, error: s(sub.data.result_message) || "Failed to force complete Picking" });
    }

    if (jobs.length) await followJobs(jobs);

    const done = results.filter((r) => r.success && !r.warning && !r.pending);
    const pending = results.filter((r) => r.pending);
    const warned = results.filter((r) => r.success && r.warning);
    const failedRows = results.filter((r) => !r.success);
    const lines = done.map((r) => r.message || `${r.to_id}: force completed`)
      .concat(pending.map((r) => r.message))
      .concat(warned.map((r) => `${r.to_id}: ${r.warning}`))
      .concat(failedRows.map((r) => `${r.to_id}: ${r.error}`));
    if (skipped.length) lines.push("Skipped (not In Progress): " + skipped.join(", "));
    const text = lines.join("<br>");

    this.hideLoading();
    if (failedRows.length > 0) this.$message.error(text);
    else if (warned.length > 0 || pending.length > 0 || skipped.length > 0) this.$message.warning(text);
    else this.$message.success(text);
    this.refresh();
    this.hide("tabs_picking");
  } catch (error) {
    this.hideLoading();
    console.error(error);
  }
})();
