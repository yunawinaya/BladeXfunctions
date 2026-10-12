// Picking form - Save as Completed through the background save (PICKING_ASYNC_SUBMIT -> PICKING_ASYNC_WORKER).
// Sends only the lines with a picked quantity; the server re-reads everything else from the stored Picking. Any case the
// background save does not handle yet (a new Picking, a Draft, a bin / batch move, mobile split data, or what the server
// answers NOT_ELIGIBLE: Picking Plan, Full Picking, Loading Bay, Auto Complete GD) runs the old onSave_Completed unchanged.
// The workflow ids are dev ids.
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

const closeDialog = (data) => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    if (data.to_no && data.to_no.length > 0) {
      this.parentGenerateForm.hide("custom_41s73hyl");
    } else {
      this.parentGenerateForm.hide("tabs_picking");
    }
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
      const moved = (row.target_location && String(row.target_location) !== String(row.source_bin || "")) || (row.target_batch && String(row.target_batch) !== String(row.batch_no || ""));
      if (moved) return oldPath("a bin / batch move");
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
        () => {
          if (this.parentGenerateForm) this.parentGenerateForm.refresh();
        },
        (e) => console.error("Picking V2: worker start failed - the scheduled worker picks the job up", e),
      );
    } catch (e) {
      console.error("Picking V2: worker could not be started", e);
    }
  } catch (error) {
    this.models["_data"] = { ...this.models["_data"], pk_v2_submitting: 0 };
    this.hideLoading();
    console.error("Picking V2 save error:", error);
    this.$message.error(error.message || "Failed to save Picking");
  }
})();
