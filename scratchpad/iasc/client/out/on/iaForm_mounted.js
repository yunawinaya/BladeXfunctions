const showStatusHTML = (status) => {
  const statusMap = {
    Draft: "draft_status",
    Issued: "issued_status",
    Completed: "completed_status",
    "Fully Posted": "fullyposted_status",
    Processing: "processing_status",
  };
  if (statusMap[status]) {
    this.display([statusMap[status]]);
  }
};

const EDIT_DISABLED_FIELDS = [
  "issuing_operation_faci",
  "stock_movement_no",
  "stock_movement_no_type",
  "item_id",
  "item_name",
  "item_desc",
  "item_qty",
  "item_uom",
  "issued_by",
  "project_id",
  "batch_no",
  "manufacturing_date",
  "expired_date",
  "storage_location_id",
  "location_id",
  "inventory_category",
  "item_assembly_date",
  "reference_documents",
  "net_weight",
  "gross_weight",
  "remarks",
  "remarks_2",
  "remarks_3",
];

// Batch No is typed only under Manual Input; a System Settings batch is generated
// on completion. Any batch item takes the dates.
const showBatchFields = async (itemId) => {
  if (!itemId) return;

  const res = await db
    .collection("item")
    .where({ id: itemId })
    .field("item_batch_management,batch_number_genaration")
    .get();
  const item = res.data?.[0];
  if (item?.item_batch_management !== 1) return;

  const fields = ["manufacturing_date", "expired_date"];
  if (item.batch_number_genaration !== "According To System Settings") {
    fields.push("batch_no");
  }
  this.display(fields);
};

// Past Draft the fields are read-only, so only the ones holding a value are shown.
const showFilledBatchFields = () => {
  const filled = ["batch_no", "manufacturing_date", "expired_date"].filter(
    (field) => this.getValue(field)
  );
  if (filled.length) this.display(filled);
};

// Locking the components table is not enough on its own: this.disabled leaves the
// toolbar's Add / Batch Add buttons and the per-row delete action clickable, so
// they are taken out of the DOM as well. Same approach as MSI's editDisabledField.
const lockComponentsTable = () => {
  this.disabled(["stock_movement"], true);

  setTimeout(() => {
    const styleId = "ia-hide-row-actions";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        .fm-virtual-table__row-cell .scope-action { display: none !important; }
        .fm-virtual-table__row-cell .scope-index { display: flex !important; }
      `;
      document.head.appendChild(style);
    }

    const toolbarButtons = document.querySelectorAll(
      ".el-row .el-col.el-col-12.el-col-xs-24 .el-button.el-button--primary.el-button--default.is-link"
    );
    toolbarButtons.forEach((button) => {
      button.style.display = "none";
    });
  }, 500);
};

// Mirrors MSI: a plant-level login can only issue from its own plant, so the
// field is fixed to it and locked; an org-level login picks one.
const setPlant = (organizationId, pageStatus) => {
  const currentDept = this.getVarSystem("deptIds").split(",")[0];
  const isSameDept = currentDept === organizationId;
  const isNew = pageStatus === "Add" || pageStatus === "Clone";

  this.disabled(["issuing_operation_faci"], !isSameDept);

  if (isNew && !isSameDept) {
    this.setData({ issuing_operation_faci: currentDept });
    this.disabled(["stock_movement"], false);
    // Reuse the plant handler so the storage location and bin defaults are
    // resolved in exactly one place.
    this.triggerEvent("onChange_Plant", { value: currentDept });
  } else if (isNew && isSameDept) {
    this.disabled(["stock_movement"], true);
  }

  return currentDept;
};

// IA V2: an Item Assembly a background job holds stays Processing (read-only, no save or post button) until the job ends;
// opening it follows the job: STATUS, and a worker kick every 15 s (the completion worker for a completion, the revert worker
// for a revert). A failed background job is reported once per browser. With both switches false (or a workflow id not set)
// nothing here calls a workflow or touches browser storage.
const IA_BG_WF = {
  SUBMIT: "2112141238600376321", // IA_V2_SUBMIT
  WORKER: "2112141277456408577", // IA_V2_WORKER
  REVERT_SUBMIT: "2112141384234999809", // IA_REVERT_V2_SUBMIT
  REVERT_WORKER: "2112141417890095105", // IA_REVERT_V2_WORKER
};
// the Completed buttons' switch and the list's Revert switch
const IA_BG_ENABLED = true;
const IA_BG_REVERT_ENABLED = true;
const IA_BG_POLL_MS = 3000;
const IA_BG_KICK_MS = 15000;
const IA_BG_WAIT_MS = 420000;

const iaBgId = (v) => /^[1-9][0-9]{0,19}$/.test(String(v || "").trim());
const iaBgOn = () => IA_BG_ENABLED === true && iaBgId(IA_BG_WF.SUBMIT) && iaBgId(IA_BG_WF.WORKER);
const iaBgRevertOn = () => IA_BG_REVERT_ENABLED === true && iaBgId(IA_BG_WF.REVERT_SUBMIT) && iaBgId(IA_BG_WF.REVERT_WORKER);
const iaBgText = (v) => String(v === undefined || v === null ? "" : v).trim();

const iaBgRun = (id, params) =>
  new Promise((resolve, reject) => {
    const p = this.runWorkflow(
      id,
      params,
      (res) => resolve(res),
      (err) => reject(err),
    );
    if (p && typeof p.then === "function") p.then((res) => resolve(res), (err) => reject(err));
  });

// STATUS answers the assembly's latest job of either command; its action (DIRECT / REVERT) says which worker moves it
const iaBgStatus = async (iaId) => {
  try {
    const res = iaBgOn()
      ? await iaBgRun(IA_BG_WF.SUBMIT, { operation: "STATUS", saveAs: "Completed", pageStatus: "Edit", ia_id: String(iaId),
        idempotency_key: "", source: "FORM", form: {} })
      : await iaBgRun(IA_BG_WF.REVERT_SUBMIT, { operation: "STATUS", ia_id: String(iaId), idempotency_key: "", source: "FORM",
        min_picks: "", form: {} });
    return (res && res.data) || null;
  } catch (error) {
    console.error("Background job: status check failed", error);
    return null;
  }
};

const iaBgIsRevert = (st) => iaBgText(st && st.action) === "REVERT" || iaBgText(st && st.command) === "REVERT_IA";

const iaBgKick = (workerId, jobId) => {
  if (!workerId) return;
  try {
    const p = this.runWorkflow(
      workerId,
      { job_id: String(jobId) },
      () => {},
      (error) => console.error("Background job: worker start failed", error),
    );
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (error) {
    console.error("Background job: worker could not be started", error);
  }
};

// true when this browser already showed the job (and marks it shown)
const iaFailedSeen = (jobId) => {
  let seen = false;
  try {
    const key = "ia_v2_failed_seen_" + jobId;
    seen = localStorage.getItem(key) === "1";
    localStorage.setItem(key, "1");
  } catch (e) {}
  return seen;
};

const iaBgAlert = (message, title, type) => this.$alert(message, title, { confirmButtonText: "OK", type: type }).catch(() => {});

const iaFollowBackground = async (iaId, name, jobOnRecord) => {
  const refreshList = () => {
    if (this.parentGenerateForm) this.parentGenerateForm.refresh();
  };
  const deadline = Date.now() + IA_BG_WAIT_MS;
  let kickedAt = 0;
  let st = await iaBgStatus(iaId);
  for (;;) {
    // no job holds it (any more): stop following - the assembly on screen may be out of date
    if (st && (st.job_status === "NONE" || (iaBgText(st.terminal) === "YES" && !st.job_id))) {
      // a new assembly whose completion stopped before it was linked to its job is released only when that job is worked
      if (/^[0-9]{1,20}$/.test(jobOnRecord) && iaBgOn()) iaBgKick(IA_BG_WF.WORKER, jobOnRecord);
      refreshList();
      this.$message.warning(name + " is not being processed in the background any more. Close it and open it again to see its current state.");
      return;
    }
    if (st && st.job_id) {
      const revert = iaBgIsRevert(st);
      const verb = revert ? "reverted" : "completed";
      const js = iaBgText(st.job_status);
      if (js === "COMPLETED") {
        this.$message.success(name + (revert ? " has been reverted to Draft." : " has been completed.") + " Reopen it to see the result.");
        refreshList();
        return;
      }
      if (js === "FAILED" || js === "CANCELLED") {
        refreshList();
        if (iaFailedSeen(st.job_id)) return;
        const reason = iaBgText(st.error_message || st.error_code || "No reason was given.");
        await iaBgAlert(reason + (/[.!?]$/.test(reason) ? "" : ".") + " Reopen it to continue.", name + " was not " + verb, "error");
        return;
      }
      if (js === "REQUIRES_REVIEW") {
        await iaBgAlert(
          "It stopped part-way through and needs a review before it can be changed. Please contact support." +
            (st.error_message ? " (" + st.error_message + ")" : ""),
          name + " needs a review",
          "warning",
        );
        return;
      }
      // a job waiting out a retry backoff, a stock-lock wait or a parked second phase moves only when kicked again
      if (!kickedAt || Date.now() - kickedAt >= IA_BG_KICK_MS) {
        if (!kickedAt) this.$message.info(name + " is being " + verb + " in the background. It is read-only until that finishes.");
        kickedAt = Date.now();
        iaBgKick(revert ? (iaBgRevertOn() ? IA_BG_WF.REVERT_WORKER : "") : iaBgOn() ? IA_BG_WF.WORKER : "", st.job_id);
      }
    }
    if (Date.now() >= deadline) {
      this.$message.info(name + " is still being processed in the background. Reopen it later.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, IA_BG_POLL_MS));
    st = await iaBgStatus(iaId);
  }
};

// an assembly a background job once held (ia_v2_job_id) and released: a failure is shown once per browser; a job with nothing
// to show is not asked about again in this browser
const iaShowLastFailure = async (iaId, jobId, name) => {
  try {
    if (localStorage.getItem("ia_v2_failed_seen_" + jobId) === "1") return;
  } catch (e) {
    return;
  }
  const st = await iaBgStatus(iaId);
  if (!st || !st.job_id) return;
  const js = iaBgText(st.job_status);
  if (["FAILED", "CANCELLED", "COMPLETED"].indexOf(js) < 0) return;
  const shown = iaFailedSeen(st.job_id);
  if (String(st.job_id) !== String(jobId)) iaFailedSeen(jobId);
  if (shown || js === "COMPLETED") return;
  const reason = iaBgText(st.error_message || st.error_code || "No reason was given.");
  this.$message.warning(name + ": its last background " + (iaBgIsRevert(st) ? "revert" : "completion") + " failed - " + reason);
};

const iaBackgroundView = (pageStatus, status) => {
  if (pageStatus !== "Edit" && pageStatus !== "View") return;
  const on = iaBgOn() || iaBgRevertOn();
  if (status !== "Processing" && (!on || (status !== "Draft" && status !== "Completed"))) return;
  const jobOnRecord = iaBgText(this.getValue("ia_v2_job_id"));
  if (status !== "Processing" && !/^[0-9]{1,20}$/.test(jobOnRecord)) return;
  const iaId = iaBgText(this.getValue("id"));
  const name = ("Item Assembly " + iaBgText(this.getValue("stock_movement_no"))).trim();
  if (status === "Processing") {
    if (!on) {
      this.$message.warning(name + " is being processed in the background. It is read-only until that finishes.");
      return;
    }
    iaFollowBackground(iaId, name, jobOnRecord);
    return;
  }
  if (iaBgId(iaId)) iaShowLastFailure(iaId, jobOnRecord, name);
};

// Small Cycle (scratchpad/iasc): after the v36 mounted work, the event sc_main (op MOUNT) shows the Small Cycle widgets for this
// page and status, reads the linked line's figures and, on a Sales Order line entry, prepares the components. Opening an
// Item Assembly never rebuilds its lines.
const SC_ENABLED = true;
const SC_WF_PROJECTION = "2112448183267332097"; // SO_IA_PROJECTION
const SC_WF_RELINK = "2112448260018900994"; // IA_SC_RELINK
const scMount = (pageStatus, status) => {
  if (!(SC_ENABLED === true && /^[1-9][0-9]{0,19}$/.test(SC_WF_PROJECTION) && /^[1-9][0-9]{0,19}$/.test(SC_WF_RELINK))) return;
  this.triggerEvent("sc_main", { scOp: "MOUNT", pageStatus: pageStatus, status: status });
};
// -- end Small Cycle --
(async () => {
  try {
    let pageStatus = "";

    if (this.isAdd) pageStatus = "Add";
    else if (this.isEdit) pageStatus = "Edit";
    else if (this.isView) pageStatus = "View";
    else if (this.isCopy) pageStatus = "Clone";
    else throw new Error("Invalid page state");

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    this.setData({ page_status: pageStatus });
    const status = this.getValue("item_assembly_status");

    // Assemblies saved before the field existed were all received Unrestricted.
    if (pageStatus !== "Add" && !this.getValue("inventory_category")) {
      this.setData({ inventory_category: "Unrestricted" });
    }

    switch (pageStatus) {
      case "Add":
      case "Clone":
        this.setData({
          organization_id: organizationId,
          issued_by: this.getVarGlobal("nickname"),
          item_assembly_date: new Date().toISOString().split("T")[0],
        });
        this.display([
          "draft_status",
          "button_draft",
          "button_completed",
          "comp_post_button",
        ]);

        setPlant(organizationId, pageStatus);

        if (pageStatus === "Clone") {
          // A batch belongs to one assembly run, so a clone starts without one.
          this.setData({
            batch_no: "",
            manufacturing_date: null,
            expired_date: null,
          });
          await showBatchFields(this.getValue("item_id"));
        }
        break;

      case "Edit":
        showStatusHTML(status);

        // A draft is still being written, so the header stays editable; every
        // later status locks it. Same rule as Handling Unit and Misc Issue.
        if (status !== "Draft") {
          this.disabled(EDIT_DISABLED_FIELDS, true);
        }

        if (status === "Completed") {
          this.display(["button_post"]);
          lockComponentsTable();
        } else if (status === "Draft") {
          this.display([
            "button_draft",
            "button_completed",
            "comp_post_button",
          ]);
        } else if (status === "Processing") {
          // a background job holds it: read-only, no save or post button
          this.hide(["button_draft", "button_completed", "comp_post_button", "button_post"]);
          lockComponentsTable();
        } else {
          // Fully Posted and anything else past Draft: the stock has already
          // moved, so the components must not be editable either.
          this.display(["button_completed", "comp_post_button"]);
          lockComponentsTable();
        }

        if (status === "Draft") await showBatchFields(this.getValue("item_id"));
        else showFilledBatchFields();
        break;

      case "View":
        showStatusHTML(status);
        this.disabled(EDIT_DISABLED_FIELDS, true);
        lockComponentsTable();
        showFilledBatchFields();
        break;
    }

    iaBackgroundView(pageStatus, status);
    scMount(pageStatus, status);
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();

setTimeout(async () => {
  if (!this.isAdd && !this.isCopy) return;

  const maxRetries = 10;
  const interval = 500;
  for (let i = 0; i < maxRetries; i++) {
    const op = await this.onDropdownVisible("stock_movement_no_type", true);
    if (op != null) break;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  function getDefaultItem(arr) {
    return arr?.find((item) => item?.item?.is_default === 1);
  }

  const params = this.getComponent("stock_movement_no");
  const { options } = params;
  const optionsData = this.getOptionData("stock_movement_no_type") || [];
  const defaultData = getDefaultItem(optionsData);

  if (options?.canManualInput) {
    if (!optionsData.some((option) => option.value === -9999)) {
      this.setOptionData("stock_movement_no_type", [
        { label: "Manual Input", value: -9999 },
        ...optionsData,
      ]);
    }
    this.setData({
      stock_movement_no_type: defaultData ? defaultData.value : -9999,
    });
  } else if (defaultData) {
    this.setData({ stock_movement_no_type: defaultData.value });
  }
}, 200);
