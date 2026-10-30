// Small Cycle (scratchpad/iasc): RES-01 - a saved IA's raw-material reservation (IA_HOLD), started here once IA_SAVE answered:
// IA_SAVE never runs it (a failure inside the save would fail it after the IA was written; user 10-21). An IA saved as Created (BA,
// 10-22), or one still marked (a Draft gives back what it holds); up to 50 hold picks it is waited for and its result shown, above it
// runs in the background.
const RES_ENABLED = true;
const RES_HOLD = "2112752274794217473"; // IA_HOLD
const RES_WAIT_PICKS = 50;
const resHoldAfterSave = async (saved, data) => {
  const s = (v) => (v === undefined || v === null ? "" : String(v));
  if (!RES_ENABLED || !/^[1-9][0-9]{0,19}$/.test(RES_HOLD)) return;
  const id = s(saved && saved.id) || s(data.id);
  const created = s(data.ia_target_status) === "Created";
  if (!/^[0-9]{1,20}$/.test(id) || !/^[0-9]{1,20}$/.test(s(data.organization_id)) || !(created || s(data.material_hold_status) !== "")) return;
  let picks = 0;
  (Array.isArray(data.stock_movement) ? data.stock_movement : []).forEach((l) => {
    let t = [];
    try {
      t = typeof (l && l.temp_qty_data) === "string" ? JSON.parse(l.temp_qty_data || "[]") : (l && l.temp_qty_data) || [];
    } catch (e) {
      t = [];
    }
    (Array.isArray(t) ? t : []).forEach((p) => {
      if (parseFloat(p && p.sm_quantity) > 0) picks += 1;
    });
  });
  const params = { ia_id: id, organization_id: s(data.organization_id), operation: "RECONCILE", source: "SAVE" };
  const run = () =>
    new Promise((resolve, reject) => {
      const p = this.runWorkflow(RES_HOLD, params, (res) => resolve(res), (err) => reject(err));
      if (p && typeof p.then === "function") p.then((res) => resolve(res), (err) => reject(err));
    });
  // a Draft never reserves (RES-01 Created, BA 10-22): one still marked gives back what it holds, quietly; NONE / CLOSED hold nothing
  // (review 4)
  if (!created) {
    const mark = s(data.material_hold_status);
    if (mark !== "NONE" && mark !== "CLOSED") run().catch((e) => console.error("RES-01: a Draft's holds could not be given back now", e));
    return;
  }
  if (picks > RES_WAIT_PICKS) {
    run().catch((e) => console.error("RES-01: the background reservation failed", e));
    this.$message.info("The materials are being reserved in the background.");
    return;
  }
  this.showLoading("Reserving materials...");
  let d = null;
  try {
    const res = await run();
    d = (res && res.data) || null;
  } catch (e) {
    console.error("RES-01: the reservation failed", e);
  }
  if (d && s(d.code) === "200") {
    // nothing to reserve (not enrolled, not Created or Draft): no result to show
    if (!s(d.result_json)) return;
    let status = "";
    try {
      status = s(JSON.parse(s(d.result_json)).status);
    } catch (e) {}
    if (status === "FULL" || status === "NONE") this.$message.success(s(d.message));
    else this.$message.warning(s(d.message));
    return;
  }
  this.$message.warning(s(d && d.message) || "The materials could not be reserved now: they are reserved when this Item Assembly is opened again.");
};
// -- end Small Cycle --
// ITEM_ASSEMBLY_SAVE — the server-side save; see ItemAssemblySaveWorkflow.json.
const IA_SAVE_WORKFLOW_ID = "2098335576774463489";

const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const findFieldMessage = (obj) => {
  if (obj && typeof obj === "object") {
    if (obj.field && obj.message) {
      return obj.message;
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findFieldMessage(item);
        if (found) return found;
      }
    }

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const found = findFieldMessage(obj[key]);
        if (found) return found;
      }
    }

    return obj.toString();
  }
  return null;
};

(async () => {
  // one save per click: a second click while this one validates, checks the BOM or saves is refused (the IA V2 handler's form flag,
  // which it clears before it hands a small IA over to this handler)
  const iaClaimDone = () => (this.models["_data"] = { ...this.models["_data"], ia_submitting: 0 });
  if ((this.models["_data"] || {}).ia_submitting === 1) {
    this.$message.warning("Workflow is already in progress. Please wait.");
    return;
  }
  this.models["_data"] = { ...this.models["_data"], ia_submitting: 1 };
  try {
    await this.validate();

    this.showLoading("Saving Item Assembly as draft...");

    const rawData = this.getValues();
    // sm_item_balance is the stock dialog's model, not a column on the table.
    const { sm_item_balance, ...data } = rawData;
    const pageStatus = data.page_status;

    let workflowResult;

    await this.runWorkflow(
      IA_SAVE_WORKFLOW_ID,
      { allData: data, saveAs: "Draft", pageStatus },
      (res) => {
        workflowResult = res;
      },
      (err) => {
        workflowResult = err;
      },
    );

    if (!workflowResult || !workflowResult.data) {
      this.hideLoading();
      this.$message.error("No response from workflow");
      return;
    }

    const code = workflowResult.data.code;
    if (code && String(code) !== "200") {
      this.hideLoading();
      this.$message.error(
        workflowResult.data.message ||
          workflowResult.data.msg ||
          "Failed to save the Item Assembly",
      );
      return;
    }

    this.$message.success("Item Assembly saved as draft");
    await resHoldAfterSave(workflowResult.data, data);
    this.hideLoading();
    closeDialog();
  } catch (error) {
    this.hideLoading();
    console.error(error);

    let errorMessage = "";
    if (error && typeof error === "object") {
      errorMessage = findFieldMessage(error) || "An error occurred";
      // findFieldMessage bottoms out at obj.toString(), which is the useless
      // "[object Object]" for a rejected response or a thrown validator.
      if (errorMessage === "[object Object]") {
        errorMessage =
          error.message ||
          error.msg ||
          JSON.stringify(error) ||
          "An error occurred";
      }
    } else {
      errorMessage = error;
    }

    this.$message.error(errorMessage);
  } finally {
    iaClaimDone();
  }
})();
