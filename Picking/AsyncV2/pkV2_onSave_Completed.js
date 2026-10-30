// Picking form - Save as Completed through the background save (PICKING_ASYNC_SUBMIT -> PICKING_ASYNC_WORKER).
// Sends only the lines with a picked quantity, each with the bin / batch it is picked into (Loading Bay, swaps: stage 1c);
// the server re-reads everything else from the stored Picking. Any case the background save does not handle yet (a new
// Picking, a Draft, mobile split data, or what the server answers NOT_ELIGIBLE: Picking Plan, Auto Complete GD, a move it
// leaves to the classic save) runs the old onSave_Completed unchanged. The workflow ids are dev ids.
const PK_V2_WF = {
  SUBMIT: "2109531449614647297",
  WORKER: "2109531412499251201",
};
const ASYNC_PICKING_ENABLED = true;
const PK_V2_MAX_LINES = 2000;
const HEADER_FIELDS = ["ref_doc", "remarks", "remarks_2", "remarks_3", "delivery_method", "delivery_method_text", "area_id",
  "driver_name", "ic_no", "driver_contact_no", "sp_vehicle_no", "pickup_date", "validity_of_collection", "courier_company",
  "shipping_date", "tracking_number", "est_arrival_date", "freight_charges", "ct_driver_name", "ct_driver_contact_no", "ct_ic_no",
  "vehicle_no", "est_delivery_date", "delivery_cost", "shipping_company", "ss_shipping_date", "ss_freight_charges",
  "shipping_method", "ss_est_arrival_date", "ss_tracking_number", "tpt_vehicle_number", "tpt_transport_name", "tpt_ic_no",
  "tpt_driver_contact_no", "tpt_driver_name", "di_shipping_method", "di_driver_name", "di_ic_no", "di_driver_contact_no",
  "di_shipping_company", "di_transport_name", "di_vehicle_number", "di_est_delivery_date", "di_est_arrival_date",
  "di_pickup_date", "di_validity_of_collection", "di_tracking_number", "di_freight_charges", "project_id"];

// the list shows either the GD table or the Picking Plan tabs; a refresh brings both back, so the other one is hidden again
const refreshList = (data) => {
  if (!this.parentGenerateForm) return;
  this.parentGenerateForm.refresh();
  if (data.to_no && data.to_no.length > 0) {
    this.parentGenerateForm.hide("custom_41s73hyl");
  } else {
    this.parentGenerateForm.hide("tabs_picking");
  }
};

const closeDialog = (data) => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    refreshList(data);
  }
};

// One workflow call as a promise that always settles: { ok, data } or { ok: false, error }.
const pkV2Call = (workflowId, params) =>
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

// table_picking_items is a tree (a bundle's items under `children`); header rows are display only.
const flatRows = (rows) =>
  (rows || []).flatMap((row) => [row, ...(Array.isArray(row.children) ? row.children : [])]).filter((r) => r && r.row_type !== "header");

const oldPath = async (why) => {
  console.log("Picking V2: the classic save -", why);
  await this.triggerEvent("onSave_Completed");
};

// Auto Complete GD (stage 1e): COMMIT hands each delivery this confirm left fully picked to GD Complete V2. The screen follows the
// job through STATUS - not the worker's answer, which a long run can lose in the browser (Kenhin 10-27) - and hands each queued
// completion to the browser's GD Complete drain below. P7 adds its entries just after the job is COMPLETED, so the follow stays
// until the list stops growing. The GD and Picking lists' sweeps are the safety net
const PK_V2_GD_COMPLETE_WORKER = "2110182645714518018";
const PK_V2_POLL_MS = 3000;
const PK_V2_POLL_MAX = 50;
const gdCompleteList = (raw) => {
  let list = Array.isArray(raw) ? raw : [];
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw || "[]");
    } catch (e) {
      list = [];
    }
  }
  return Array.isArray(list) ? list : [];
};
// One GD_COMPLETE_WORKER {} run at a time per browser (10-29) while a delivery handed over here is still completing. A run takes the
// tenant's earliest due job (one stock call per run), so the next starts PK_V2_DRAIN_NEXT_MS after a run that moved one,
// PK_V2_DRAIN_SLOW_MS after one that moved nothing (a job that lost the stock lock is due again 15 s, 30 s... later) and
// PK_V2_DRAIN_FAILED_MS after a failed run or one with no answer within PK_V2_DRAIN_LOST_MS. Starting every completion at once and
// then one run per 15 s left ~10 s of each 15 idle (Kenhin 10-29: 24 completions in 306 s). It stops once every delivery handed
// over has ended or after PK_V2_DRAIN_QUIET_MS without progress; each run stamps pkv2_gdc_kick_at, so the Picking list's sweep
// holds back meanwhile
const PK_V2_GDC_SUBMIT = "2110182609618337794";
const PK_V2_DRAIN_NEXT_MS = 1000;
const PK_V2_DRAIN_SLOW_MS = 5000;
const PK_V2_DRAIN_FAILED_MS = 15000;
const PK_V2_DRAIN_LOST_MS = 60000;
const PK_V2_DRAIN_QUIET_MS = 180000;
const PK_V2_GDC_OPEN = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_GD"];
// a run moved a job when one of its jobs left the state it was read in
const pkV2GdcMoved = (d) => {
  if (String(d.worker_route || "") !== "WORKED") return false;
  try {
    const jobs = JSON.parse(d.jobs || "[]");
    return Array.isArray(jobs) && jobs.some((j) => j && String(j.before || "") !== String(j.job_status || ""));
  } catch (e) {
    return Number(d.processed || 0) > 0;
  }
};
const pkV2GdcDrain = (gdIds) => {
  const w = typeof window !== "undefined" ? window : {};
  const d = (w.pkV2GdcDrain = w.pkV2GdcDrain || { open: {}, active: false });
  gdIds.forEach((gdId) => {
    d.open[String(gdId)] = 1;
  });
  d.run = this.runWorkflow.bind(this);
  if (d.active) return;
  d.active = true;
  let progressAt = Date.now();
  const step = async () => {
    const open = Object.keys(d.open);
    if (!open.length || Date.now() - progressAt > PK_V2_DRAIN_QUIET_MS) {
      d.open = {};
      d.active = false;
      return;
    }
    try {
      localStorage.setItem("pkv2_gdc_kick_at", String(Date.now()));
    } catch (e) {}
    const answer = await new Promise((resolve) => {
      const lost = setTimeout(() => resolve(null), PK_V2_DRAIN_LOST_MS);
      const settle = (v) => {
        clearTimeout(lost);
        resolve(v);
      };
      try {
        d.run(PK_V2_GD_COMPLETE_WORKER, {}, (res) => settle((res && res.data) || {}), (e) => {
          console.error("GD Complete V2: run failed - the lists' sweep picks it up", e);
          settle(null);
        });
      } catch (e) {
        console.error("GD Complete V2: could not be started", e);
        settle(null);
      }
    });
    const moved = answer ? pkV2GdcMoved(answer) : false;
    if (moved) progressAt = Date.now();
    else {
      // nothing moved: which deliveries handed over are still completing (an unanswered read keeps one followed)
      const st = await Promise.all(open.map((gdId) => pkV2Call(PK_V2_GDC_SUBMIT, { operation: "STATUS", gd_id: gdId, source: "PICKING" })));
      open.forEach((gdId, k) => {
        if (st[k].ok && PK_V2_GDC_OPEN.indexOf(String(st[k].data.job_status || "")) < 0) delete d.open[gdId];
      });
    }
    setTimeout(step, answer === null ? PK_V2_DRAIN_FAILED_MS : moved ? PK_V2_DRAIN_NEXT_MS : PK_V2_DRAIN_SLOW_MS);
  };
  step();
};
const followGdCompletes = async (pickingId, organizationId) => {
  const msg = this.$message;
  const started = {};
  const named = {};
  let lastSize = -1;
  let stable = 0;
  for (let i = 0; i < PK_V2_POLL_MAX; i++) {
    await new Promise((r) => setTimeout(r, PK_V2_POLL_MS));
    const st = await pkV2Call(PK_V2_WF.SUBMIT, { picking_id: String(pickingId), organization_id: String(organizationId), operation: "STATUS" });
    if (!st.ok) continue;
    const js = String(st.data.job_status || "");
    if (js === "FAILED" || js === "REQUIRES_REVIEW") return;
    if (js !== "COMPLETED") continue;
    const list = gdCompleteList(st.data.gd_complete);
    const fresh = list.filter((g) => g && g.status === "QUEUED" && g.job_id && !started[g.job_id]);
    for (const g of fresh) started[g.job_id] = 1;
    if (fresh.length) {
      pkV2GdcDrain(fresh.map((g) => String(g.gd_id)));
      msg.success("Completing " + fresh.map((g) => g.gd_no || g.gd_id).join(", ") + " in the background.");
    }
    const waiting = list.filter((g) => g && g.status === "NOT_QUEUED" && !named[g.gd_id]);
    for (const g of waiting) named[g.gd_id] = 1;
    if (waiting.length) msg.warning("Not completed automatically: " + waiting.map((g) => (g.gd_no || g.gd_id) + " - " + (g.message || g.code)).join("; "));
    stable = list.length === lastSize ? stable + 1 : 0;
    lastSize = list.length;
    if (stable >= 3) return;
  }
};

(async () => {
  const data = this.getValues();
  try {
    if ((this.models["_data"] || {}).pk_v2_submitting === 1) {
      this.$message.warning("A save request is already being sent. Please wait.");
      return;
    }
    if (!ASYNC_PICKING_ENABLED || !PK_V2_WF.SUBMIT || PK_V2_WF.SUBMIT.indexOf("__") === 0) return oldPath("switched off");
    if (data.page_status === "Add" || !data.id) return oldPath("a new Picking");
    if (data.to_status === "Draft") return oldPath("a Draft Picking");
    if (data.split_data || data.individual_remarks) return oldPath("split / mobile data");

    const lines = [];
    for (const row of flatRows(data.table_picking_items)) {
      if (row.line_status === "Cancelled") continue;
      if (row.item_bundle_id && !row.item_code) continue;
      const qty = parseFloat(row.picked_qty) || 0;
      if (qty <= 0) continue;
      if (row._is_split_entry || (Array.isArray(row._mobile_locations) && row._mobile_locations.length)) return oldPath("split rows");
      lines.push({
        row_id: String(row.id),
        qty: qty,
        pick_uom: String(row.picking_uom || row.item_uom || ""),
        target_location_id: row.target_location ? String(row.target_location) : "",
        target_batch_id: row.target_batch ? String(row.target_batch) : "",
        remark: row.remark || "",
        remark_2: row.remark_2 || "",
        remark_3: row.remark_3 || "",
        attachment: Array.isArray(row.attachment) ? row.attachment : [],
      });
    }
    if (!lines.length) {
      this.$message.error("Cannot complete picking. At least one item must have picked quantity greater than 0.");
      return;
    }
    if (lines.length > PK_V2_MAX_LINES) {
      this.$message.error("This confirmation has " + lines.length + " picked lines. The maximum is " + PK_V2_MAX_LINES + ".");
      return;
    }

    const headerPatch = {};
    for (const k of HEADER_FIELDS) if (data[k] !== undefined) headerPatch[k] = data[k];
    let organizationId = String(data.organization_id || "");
    if (!organizationId) {
      organizationId = String(this.getVarGlobal("deptParentId") || "");
      if (!organizationId || organizationId === "0") organizationId = String(this.getVarSystem("deptIds") || "").split(",")[0];
    }
    // one key per click: a retry of a click that got no answer reuses it, so the same confirmation is never queued twice
    let key = (this.models["_data"] || {}).pk_v2_key;
    if (!key) {
      key = "PK-" + data.id + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      this.models["_data"] = { ...this.models["_data"], pk_v2_key: key };
    }
    const params = { picking_id: String(data.id), organization_id: organizationId, operation: "CONFIRM", idempotency_key: key, payload: JSON.stringify({ lines: lines, header_patch: headerPatch }), confirmed_by: this.getVarGlobal("nickname") || "" };

    this.models["_data"] = { ...this.models["_data"], pk_v2_submitting: 1 };
    this.showLoading("Submitting Picking...");
    let res;
    try {
      res = await pkV2Call(PK_V2_WF.SUBMIT, params);
      if (!res.ok) res = await pkV2Call(PK_V2_WF.SUBMIT, params);
    } finally {
      this.models["_data"] = { ...this.models["_data"], pk_v2_submitting: 0 };
      this.hideLoading();
    }
    if (!res || !res.ok) {
      this.$message.error("The save request did not complete (" + ((res && res.error) || "no answer") + "). Press the button again: the same picking is never saved twice.");
      return;
    }
    const out = res.data;
    if (out.route === "NOT_ELIGIBLE") {
      this.models["_data"] = { ...this.models["_data"], pk_v2_key: null };
      return oldPath(out.result_message);
    }
    if (String(out.result_code) !== "200" || !out.job_id) {
      this.models["_data"] = { ...this.models["_data"], pk_v2_key: null };
      this.$message.error(out.result_message || "The Picking could not be submitted.");
      return;
    }
    this.models["_data"] = { ...this.models["_data"], pk_v2_key: null };
    this.$message.success("Picking submitted. It is being saved in the background; reopen it in a moment.");
    closeDialog(data);
    // start the worker now; its scheduled run is the safety net, so a failed start is only logged
    try {
      this.runWorkflow(
        PK_V2_WF.WORKER,
        { job_id: String(out.job_id) },
        () => refreshList(data),
        (e) => console.error("Picking V2: worker start failed - the scheduled worker picks the job up", e),
      );
    } catch (e) {
      console.error("Picking V2: worker could not be started", e);
    }
    followGdCompletes(data.id, organizationId);
  } catch (error) {
    this.models["_data"] = { ...this.models["_data"], pk_v2_submitting: 0 };
    this.hideLoading();
    console.error("Picking V2 save error:", error);
    this.$message.error(error.message || "Failed to save Picking");
  }
})();
