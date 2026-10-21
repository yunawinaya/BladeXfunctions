// Populate the one-row UI table from the database-backed main fields.
this.setData({
  item_display_table: [{
    item_selection: this.getValue("item_id") || "",
    item_code: this.getValue("item_code") || "",
    item_name: this.getValue("item_name") || "",
    item_desc: this.getValue("item_desc") || "",
    item_qty: this.getValue("item_qty") || 0,
    item_uom: this.getValue("item_uom") || "",
    stock_summary: this.getValue("stock_summary") || "",
  }],
});

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

const configureBatchFields = (status) => {
  const rows = this.getValue("stock_movement") || [];
  const fields = [
    "stock_movement.batch_number",
    "stock_movement.manufacturing_date",
    "stock_movement.expired_date",
  ];
  const hasBatchItem = rows.some(
    (row) => row?.item_selection && row.batch_number !== "-",
  );

  if (hasBatchItem) this.display(fields);
  else this.hide(fields);

  const editable =
    this.isAdd || this.isCopy || (this.isEdit && status === "Draft");
  if (!editable) return;

  rows.forEach((row, index) => {
    const isNoBatch = row.batch_number === "-";
    const isSystemGenerated =
      row.batch_number === "Auto-generated batch number";
    this.disabled(
      `stock_movement.${index}.batch_number`,
      isNoBatch || isSystemGenerated,
    );
    this.disabled(
      [
        `stock_movement.${index}.manufacturing_date`,
        `stock_movement.${index}.expired_date`,
      ],
      isNoBatch,
    );
  });
};

// Same Edit/View pattern as Item Assembly: every row persists the UOM records
// it is allowed to use, then restores them when the table is rendered again.
const restoreRecoveryUomOptions = () => {
  const rows = this.getValue("stock_movement") || [];

  rows.forEach((row, index) => {
    let options = row.uom_options || [];
    if (typeof options === "string") {
      try {
        options = JSON.parse(options || "[]");
      } catch (error) {
        options = [];
      }
    }
    if (!Array.isArray(options)) options = [];

    this.setOptionData(
      [`stock_movement.${index}.quantity_uom`],
      options,
    );
  });
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
  "item_disassembly_date",
  "reference_documents",
  "net_weight",
  "gross_weight",
  "remarks",
  "remarks_2",
  "remarks_3",
];

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

// IDA V2: a Processing Item Disassembly is read-only until its background job ends; opening it follows the job (STATUS, a worker
// kick every 15 s) and a failed job is shown once per browser. Switch off or an id not set: no workflow call, no browser storage.
const IDA_BG_WF = {
  SUBMIT: "2112748971830149121", // IDA_V2_SUBMIT
  WORKER: "2112749010379997186", // IDA_V2_WORKER
};
const IDA_BG_ENABLED = true;
const IDA_BG_POLL_MS = 3000;
const IDA_BG_KICK_MS = 15000;
const IDA_BG_WAIT_MS = 420000;

const idaBgId = (v) => /^[1-9][0-9]{0,19}$/.test(String(v || "").trim());
const idaBgOn = () => IDA_BG_ENABLED === true && idaBgId(IDA_BG_WF.SUBMIT) && idaBgId(IDA_BG_WF.WORKER);
const idaBgText = (v) => String(v === undefined || v === null ? "" : v).trim();

const idaBgRun = (id, params) =>
  new Promise((resolve, reject) => {
    const p = this.runWorkflow(
      id,
      params,
      (res) => resolve(res),
      (err) => reject(err),
    );
    if (p && typeof p.then === "function") p.then((res) => resolve(res), (err) => reject(err));
  });

const idaBgStatus = async (idaId) => {
  try {
    const res = await idaBgRun(IDA_BG_WF.SUBMIT, { operation: "STATUS", saveAs: "Completed", pageStatus: "Edit", ida_id: String(idaId),
      idempotency_key: "", source: "FORM", form: {} });
    return (res && res.data) || null;
  } catch (error) {
    console.error("Item Disassembly V2: status check failed", error);
    return null;
  }
};

const idaBgKick = (jobId) => {
  try {
    const p = this.runWorkflow(
      IDA_BG_WF.WORKER,
      { job_id: String(jobId) },
      () => {},
      (error) => console.error("Item Disassembly V2: worker start failed", error),
    );
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (error) {
    console.error("Item Disassembly V2: worker could not be started", error);
  }
};

// true when this browser already showed the job (and marks it shown)
const idaFailedSeen = (jobId) => {
  let seen = false;
  try {
    const key = "ida_v2_failed_seen_" + jobId;
    seen = localStorage.getItem(key) === "1";
    localStorage.setItem(key, "1");
  } catch (e) {}
  return seen;
};

const idaBgAlert = (message, title, type) => this.$alert(message, title, { confirmButtonText: "OK", type: type }).catch(() => {});

const idaFollowBackground = async (idaId, name, jobOnRecord) => {
  const refreshList = () => {
    if (this.parentGenerateForm) this.parentGenerateForm.refresh();
  };
  const deadline = Date.now() + IDA_BG_WAIT_MS;
  let kickedAt = 0;
  let st = await idaBgStatus(idaId);
  for (;;) {
    if (st && (st.job_status === "NONE" || (idaBgText(st.terminal) === "YES" && !st.job_id))) {
      // a new disassembly whose completion stopped before its link is released only when that job is worked
      if (/^[0-9]{1,20}$/.test(jobOnRecord)) idaBgKick(jobOnRecord);
      refreshList();
      this.$message.warning(name + " is not being processed in the background any more. Close it and open it again to see its current state.");
      return;
    }
    if (st && st.job_id) {
      const js = idaBgText(st.job_status);
      if (js === "COMPLETED") {
        this.$message.success(name + " has been completed. Reopen it to see the result.");
        refreshList();
        return;
      }
      if (js === "FAILED" || js === "CANCELLED") {
        refreshList();
        if (idaFailedSeen(st.job_id)) return;
        const reason = idaBgText(st.error_message || st.error_code || "No reason was given.");
        await idaBgAlert(reason + (/[.!?]$/.test(reason) ? "" : ".") + " Reopen it to continue.", name + " was not completed", "error");
        return;
      }
      if (js === "REQUIRES_REVIEW") {
        await idaBgAlert(
          "It stopped part-way through and needs a review before it can be changed. Please contact support." +
            (st.error_message ? " (" + st.error_message + ")" : ""),
          name + " needs a review",
          "warning",
        );
        return;
      }
      // a retry backoff, a stock-lock wait or a parked second phase moves only when the worker is kicked again
      if (!kickedAt || Date.now() - kickedAt >= IDA_BG_KICK_MS) {
        if (!kickedAt) this.$message.info(name + " is being completed in the background. It is read-only until that finishes.");
        kickedAt = Date.now();
        idaBgKick(st.job_id);
      }
    }
    if (Date.now() >= deadline) {
      this.$message.info(name + " is still being processed in the background. Reopen it later.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, IDA_BG_POLL_MS));
    st = await idaBgStatus(idaId);
  }
};

// a disassembly a job once held (ida_v2_job_id) and released: its failure is shown once per browser; a job with nothing to
// show is not asked about again in this browser
const idaShowLastFailure = async (idaId, jobId, name) => {
  try {
    if (localStorage.getItem("ida_v2_failed_seen_" + jobId) === "1") return;
  } catch (e) {
    return;
  }
  const st = await idaBgStatus(idaId);
  if (!st || !st.job_id) return;
  const js = idaBgText(st.job_status);
  if (["FAILED", "CANCELLED", "COMPLETED"].indexOf(js) < 0) return;
  const shown = idaFailedSeen(st.job_id);
  if (String(st.job_id) !== String(jobId)) idaFailedSeen(jobId);
  if (shown || js === "COMPLETED") return;
  const reason = idaBgText(st.error_message || st.error_code || "No reason was given.");
  this.$message.warning(name + ": its last background completion failed - " + reason);
};

const idaBackgroundView = (pageStatus, status) => {
  if (pageStatus !== "Edit" && pageStatus !== "View") return;
  const on = idaBgOn();
  if (status !== "Processing" && (!on || (status !== "Draft" && status !== "Completed"))) return;
  const jobOnRecord = idaBgText(this.getValue("ida_v2_job_id"));
  if (status !== "Processing" && !/^[0-9]{1,20}$/.test(jobOnRecord)) return;
  const idaId = idaBgText(this.getValue("id"));
  const name = ("Item Disassembly " + idaBgText(this.getValue("stock_movement_no"))).trim();
  if (status === "Processing") {
    if (!on) {
      this.$message.warning(name + " is being processed in the background. It is read-only until that finishes.");
      return;
    }
    idaFollowBackground(idaId, name, jobOnRecord);
    return;
  }
  if (idaBgId(idaId)) idaShowLastFailure(idaId, jobOnRecord, name);
};

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
    const status = this.getValue("item_disassembly_status");
    configureBatchFields(status);

    switch (pageStatus) {
      case "Add":
      case "Clone":
        this.setData({
          organization_id: organizationId,
          issued_by: this.getVarGlobal("nickname"),
          item_disassembly_date: new Date().toISOString().split("T")[0],
        });
        this.display([
          "draft_status",
          "button_draft",
          "button_completed",
          "comp_post_button",
        ]);

        setPlant(organizationId, pageStatus);
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
        break;

      case "View":
        showStatusHTML(status);
        this.disabled(EDIT_DISABLED_FIELDS, true);
        lockComponentsTable();
        break;
    }

    idaBackgroundView(pageStatus, status);
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


// Temporary development helper.
this.display(["button_kdsxzl2q"]);


// The single source BOM is selected in the header. Hide detail areas until the
// user has chosen it.
setTimeout(() => {
  const detailAreas = ["item_disassembly", "recovered_tab"];
  if (this.getValue("item_id")) this.display(detailAreas);
  else this.hide(detailAreas);
}, 0);

setTimeout(async () => {
  if (!this.isAdd) await restoreRecoveryUomOptions();
}, 500);

// Restore the conditional source controls on Edit/View. A saved allocation with
// several loose rows or any HU row is dialog-driven; one loose row is qty-driven.
setTimeout(() => {
  const parseRows = (raw) => {
    try {
      const parsed = JSON.parse(raw || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  };
  const loose = parseRows(this.getValue("temp_qty_data"));
  const hu = parseRows(this.getValue("temp_hu_data"));
  const hasItem = Boolean(this.getValue("item_id"));
  const mode = !hasItem
    ? "none"
    : hu.length > 0 || loose.length > 1
      ? "multiple"
      : loose.length === 1
        ? "single"
        : "none";
  this.models["ida_source_stock_mode"] = mode;

  const status = this.getValue("item_disassembly_status");
  const editable =
    this.isAdd || this.isCopy || (this.isEdit && status === "Draft");
  this.disabled(
    "item_display_table.0.item_qty",
    !editable || mode !== "single",
  );
  this.disabled(
    "item_display_table.0.transfer_stock",
    !editable || mode !== "multiple",
  );
}, 0);
