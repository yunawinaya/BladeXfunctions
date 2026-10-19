const showStatusHTML = (status) => {
  const statusMap = {
    Draft: "draft_status",
    Created: "created_status",
    "In Progress": "processing_status",
    Completed: "completed_status",
    Cancelled: "cancel_status",
    Processing: "lot_processing_status",
  };

  if (statusMap[status]) {
    this.display([statusMap[status]]);
  }
};

const CONFIG = {
  fields: {
    all: [
      "stock_movement.item_selection",
      "stock_movement.transfer_stock",
      "stock_movement.total_quantity",
      "stock_movement.quantity_uom",
      "stock_movement.location_id",
      "stock_movement.storage_location_id",
      "stock_movement.stock_summary",
      "movement_reason",
      "is_production_order",
    ],
    buttons: ["button_save_as_draft", "button_inprogress", "button_completed"],
    hide: [
      "stock_movement.unit_price",
      "stock_movement.amount",
      "stock_movement.category",
      "receiving_operation_faci",
    ],
  },
  buttonConfig: {
    Add: ["button_save_as_draft", "button_inprogress", "button_completed"],
    Draft: ["button_save_as_draft", "button_inprogress", "button_completed"],
    Created: ["button_inprogress", "button_completed"],
    "In Progress": ["button_inprogress", "button_completed"],
  },
};

const initMovementReason = async () => {
  const resType = await db
    .collection("blade_dict")
    .where({ dict_key: "Location Transfer" })
    .get();

  const movementTypeId = resType.data[0]?.id;

  if (movementTypeId) {
    const resReason = await db
      .collection("blade_dict")
      .where({ parent_id: movementTypeId })
      .get();
    this.setOptionData("movement_reason", resReason.data);
  }
};

const configureFields = (isProductionOrder) => {
  this.display(CONFIG.fields.all);
  this.hide(CONFIG.fields.hide);

  if (isProductionOrder) {
    this.display(["stock_movement.requested_qty"]);
  }

  // total_quantity is disabled per row by the column's own expression:
  // editable only on a bundle parent, disabled on plain lines and bundle
  // children. A blanket disable here would override that and lock the
  // bundle parent too.
};

const configureButtons = (pageStatus, stockMovementStatus) => {
  this.hide(CONFIG.fields.buttons);

  if (pageStatus === "Add" || stockMovementStatus === "Draft") {
    this.display(CONFIG.buttonConfig.Draft);
  } else if (stockMovementStatus === "Created") {
    this.display(CONFIG.buttonConfig.Created);
  } else if (stockMovementStatus === "In Progress") {
    this.display(CONFIG.buttonConfig["In Progress"]);
  }
};

const showProductionOrder = (data) => {
  if (data.is_production_order === 1) {
    this.display(["production_order_id", "is_production_order"]);
    this.disabled(
      [
        "stock_movement.item_selection",
        "stock_movement.location_id",
        "stock_movement.storage_location_id",
      ],
      true,
    );
  }
};

const editDisabledField = () => {
  this.disabled(
    [
      "issue_date",
      "stock_movement_no",
      "movement_type",
      "movement_reason",
      "issued_by",
      "issuing_operation_faci",
      "remarks",
      "remark",
      "remark2",
      "remark3",
      "reference_documents",
      "movement_id",
      "is_production_order",
      "production_order_id",
      "stock_movement",
      "stock_movement.item_selection",
      "stock_movement.total_quantity",
      "stock_movement.location_id",
      "stock_movement.storage_location_id",
    ],
    true,
  );

  setTimeout(() => {
    const editButtons = document.querySelectorAll(
      ".el-row .el-col.el-col-12.el-col-xs-24 .el-button.el-button--primary.el-button--default.is-link",
    );
    editButtons.forEach((button) => {
      button.style.display = "none";
    });

    // Inject CSS to override hover behavior and keep row numbers visible
    const styleId = "lot-hide-row-actions";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        .fm-virtual-table__row-cell .scope-action { display: none !important; }
        .fm-virtual-table__row-cell .scope-index { display: flex !important; }
      `;
      document.head.appendChild(style);
    }
  }, 500);

  this.hide(["stock_movement.transfer_stock"]);
};

const hideSerialNumberRecordTab = () => {
  setTimeout(() => {
    const tableSerialNumber = this.getValue("table_sn_records");
    if (!tableSerialNumber || tableSerialNumber.length === 0) {
      const tab = document.querySelector(
        '.el-drawer[role="dialog"] .el-tabs__item#tab-serial_number_records',
      );
      if (tab) {
        tab.style.display = "none";
      }
    }
  }, 10);
};

const setPlant = (organizationId, pageStatus) => {
  const currentDept = this.getVarSystem("deptIds").split(",")[0];
  const isSameDept = currentDept === organizationId;

  this.disabled("issuing_operation_faci", !isSameDept);

  if (pageStatus === "Add" && !isSameDept) {
    this.setData({ issuing_operation_faci: currentDept });
  }

  return currentDept;
};

const setStorageLocation = async (plantID) => {
  try {
    if (plantID) {
      let defaultStorageLocationID = "";

      const resStorageLocation = await db
        .collection("storage_location")
        .where({
          plant_id: plantID,
          is_deleted: 0,
          is_default: 1,
          storage_status: 1,
          location_type: "Common",
        })
        .get();

      if (resStorageLocation.data && resStorageLocation.data.length > 0) {
        defaultStorageLocationID = resStorageLocation.data[0].id;
        this.setData({
          default_storage_location: defaultStorageLocationID,
        });
      }

      if (defaultStorageLocationID && defaultStorageLocationID !== "") {
        const resBinLocation = await db
          .collection("bin_location")
          .where({
            plant_id: plantID,
            storage_location_id: defaultStorageLocationID,
            is_deleted: 0,
            is_default: 1,
            bin_status: 1,
          })
          .get();

        if (resBinLocation.data && resBinLocation.data.length > 0) {
          this.setData({
            default_bin: resBinLocation.data[0].id,
          });
        }
      }
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
};

// Stock Movement V2: a transfer saved in the background stays Processing (read-only) until its job ends; opening it re-kicks
// the worker and follows the job. A failed background save is reported once per browser.
const LOT_BG_WF = {
  STATUS: "2110992282596540417", // LOT_V2_SUBMIT (operation STATUS)
  WORKER: "2110992316335521793", // LOT_V2_WORKER
};
const LOT_BG_POLL_MS = 3000;
const LOT_BG_KICK_MS = 15000;
const LOT_BG_WAIT_MS = 180000;

// SM V2 / Location Transfer - lotLineFingerprint: ONE canonical fingerprint of a Location Transfer's lines. SUBMIT (B) stamps
// it on the job (request.lineFingerprint over the STORED lines; request.incomingFingerprint over the lines a COMPLETE / EDIT
// will write at L2), COMMIT L0 (C) compares the stored lines with it, COMMIT L2 uses both to tell "written" from "not yet".
//
// Input: the lines as code/shared/sql.py FP_LINES reads them ({ j: "<JSON_OBJECT>" } rows), as plain objects (a get-node /
// adapter document's stock_movement, flattened), or the form's / code_node_yPlLXIZW's flatLines. Fields used:
//   id, line_index, item_selection (the line's item), quantity_uom, location_id (the TARGET bin), temp_qty_data
//   (text or array; per entry: material_id, location_id (the SOURCE bin), batch_id, category, sm_quantity, material_uom,
//   handling_unit_id)
// Deliberately NOT used: total_quantity and every other decimal COLUMN (the platform rounds a decimal column to the
// tenant's number rule on write, so a value read back can differ from the one written - see _cmp.js sameStored); the
// quantities that move stock are the entries' sm_quantity, kept verbatim inside the temp_qty_data text.
// Entries with sm_quantity <= 0 are kept (any change is a change); entry order is kept (it orders the movements); lines are
// ordered by id (numeric), a line without an id sorts first by line_index.
// Output: "LF1:<line count>:<16 hex>" - FNV-1a 32 + djb2 32 over the canonical text (the GR V2 client's idemKey hash).
const lotFpCanonRows = function lotFpCanonRows(lines) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const id = (v) => {
    if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? String(v) : "?" + String(v);
    const t = s(v);
    return /^[0-9]{1,20}$/.test(t) || t === "" ? t : "?" + t;
  };
  const q8t = (v) => (v === undefined || v === null || s(v) === "" ? "" : Number((parseFloat(v) || 0).toFixed(8)).toFixed(8));
  const cat = (c) => (c === "UNR" ? "Unrestricted" : c === "BLK" ? "Blocked" : s(c) || "Unrestricted");
  const parse = (t) => {
    try {
      return JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))/g, (m, pre, num) => (num === undefined ? m : pre + '"' + num + '"')));
    } catch (e) {
      return undefined;
    }
  };
  const rows = (Array.isArray(lines) ? lines : lines ? [lines] : []).map((r) => (r && typeof r === "object" && typeof r.j === "string" ? parse(r.j) : r))
    .filter((r) => r && typeof r === "object");
  const entriesOf = (v) => {
    if (Array.isArray(v)) return v;
    const t = s(v);
    if (!t) return [];
    const p = parse(t);
    return Array.isArray(p) ? p : "RAW:" + t;
  };
  const canon = rows.map((l) => {
    const e = entriesOf(l.temp_qty_data);
    return [id(l.id), s(l.line_index), s(l.item_selection), id(l.quantity_uom), id(l.location_id),
      typeof e === "string" ? e : e.map((x) => (x && typeof x === "object" ? [s(x.material_id), id(x.location_id), id(x.batch_id), cat(x.category), q8t(x.sm_quantity),
        id(x.material_uom), s(x.handling_unit_id)] : ["?", s(x)]))];
  });
  const key = (a) => (a[0] ? "1" + String(a[0].length).padStart(2, "0") + a[0] : "0" + a[1].padStart(12, "0"));
  canon.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return canon;
};
const lotFpCanon = (lines) => JSON.stringify(lotFpCanonRows(lines));
const lotFpHash = function lotFpHash(text) {
  let h1 = 2166136261;
  let h2 = 5381;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = (Math.imul(h2, 33) + c) >>> 0;
  }
  const hex = (x) => ("00000000" + x.toString(16)).slice(-8);
  return hex(h1) + hex(h2);
};
const lotLineFingerprint = function lotLineFingerprint(lines) {
  const canon = lotFpCanonRows(lines);
  return "LF1:" + canon.length + ":" + lotFpHash(JSON.stringify(canon));
};

// the lines as the form opened them: a Completed click compares against it (COMPLETE vs COMPLETE_EDITED)
const rememberLines = (data) => {
  try {
    this.models["_data"] = { ...this.models["_data"], lot_mount_fp: lotLineFingerprint(data.stock_movement || []) };
  } catch (error) {
    console.error("Background save: line fingerprint failed", error);
  }
};

const lotBgRun = (id, params) =>
  new Promise((resolve, reject) => {
    this.runWorkflow(
      id,
      params,
      (res) => resolve(res),
      (err) => reject(err),
    );
  });

const lotBgStatus = async (lotId) => {
  try {
    const res = await lotBgRun(LOT_BG_WF.STATUS, { operation: "STATUS", saveAs: "", pageStatus: "Edit", lot_id: String(lotId), idempotency_key: "", source: "FORM", form: {} });
    return (res && res.data) || null;
  } catch (error) {
    console.error("Background save: status check failed", error);
    return null;
  }
};

const lotFailedSeen = (jobId) => {
  let seen = false;
  try {
    const key = "lot_v2_failed_seen_" + jobId;
    seen = localStorage.getItem(key) === "1";
    localStorage.setItem(key, "1");
  } catch (e) {}
  return seen;
};

const lotAlert = (message, title, type) => this.$alert(message, title, { confirmButtonText: "OK", type: type }).catch(() => {});

const followBackgroundSave = async (lotId, lotNo, jobIdOnRecord) => {
  const name = ("Location Transfer " + (lotNo || "")).trim();
  if (LOT_BG_WF.STATUS === "0" || LOT_BG_WF.WORKER === "0") {
    this.$message.warning(name + " is being processed. It is read-only until that finishes.");
    return;
  }
  const kick = (jobId) => {
    try {
      this.runWorkflow(
        LOT_BG_WF.WORKER,
        { job_id: String(jobId) },
        () => {},
        (error) => console.error("Background save: worker start failed", error),
      );
    } catch (error) {
      console.error("Background save: worker could not be started", error);
    }
  };
  const refreshList = () => {
    if (this.parentGenerateForm) this.parentGenerateForm.refresh();
  };
  const deadline = Date.now() + LOT_BG_WAIT_MS;
  let kickedAt = 0;
  let s = await lotBgStatus(lotId);
  for (;;) {
    // no job holds it (any more): stop following - the transfer on screen may be out of date
    if (s && (s.job_status === "NONE" || (String(s.terminal) === "YES" && !s.job_id))) {
      // a new transfer whose save stopped before it was linked to its job is released only when that job is worked
      if (/^[0-9]{1,20}$/.test(String(jobIdOnRecord || "").trim())) kick(String(jobIdOnRecord).trim());
      refreshList();
      this.$message.warning(name + " is not being saved in the background any more. Close it and open it again to see its current state.");
      return;
    }
    if (s && s.job_id) {
      const st = s.job_status;
      if (st === "COMPLETED") {
        this.$message.success(name + " has been saved. Reopen it to see the result.");
        refreshList();
        return;
      }
      if (st === "FAILED" || st === "CANCELLED") {
        refreshList();
        if (lotFailedSeen(s.job_id)) return;
        const reason = String(s.error_message || s.error_code || "No reason was given.").trim();
        await lotAlert(reason + (/[.!?]$/.test(reason) ? "" : ".") + " Reopen it to continue.", name + " was not saved", "error");
        return;
      }
      if (st === "REQUIRES_REVIEW") {
        await lotAlert(
          "It stopped part-way through its save and needs a review before it can be changed. Please contact support." + (s.error_message ? " (" + s.error_message + ")" : ""),
          name + " needs a review",
          "warning",
        );
        return;
      }
      // a job waiting out a retry backoff, a stock-lock wait or a parked second phase moves only when kicked again
      if (!kickedAt || Date.now() - kickedAt >= LOT_BG_KICK_MS) {
        if (!kickedAt) this.$message.info(name + " is being saved in the background. It is read-only until that finishes.");
        kickedAt = Date.now();
        kick(s.job_id);
      }
    }
    if (Date.now() >= deadline) {
      this.$message.info(name + " is still being processed in the background. Reopen it later.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, LOT_BG_POLL_MS));
    s = await lotBgStatus(lotId);
  }
};

// a transfer a background save once held (lot_v2_job_id) and released: its failure is shown once per browser
const showLastBackgroundFailure = async (lotId, jobId, lotNo) => {
  if (LOT_BG_WF.STATUS === "0") return;
  try {
    if (localStorage.getItem("lot_v2_failed_seen_" + jobId) === "1") return;
  } catch (e) {
    return;
  }
  const s = await lotBgStatus(lotId);
  if (!s || !s.job_id || ["FAILED", "CANCELLED", "COMPLETED"].indexOf(s.job_status) < 0) return;
  if (lotFailedSeen(s.job_id) || s.job_status === "COMPLETED") return;
  const reason = String(s.error_message || s.error_code || "No reason was given.").trim();
  this.$message.warning(("Location Transfer " + (lotNo || "")).trim() + ": its last background save failed - " + reason);
};

const lotBackgroundView = (pageStatus, data) => {
  if (pageStatus !== "Edit" && pageStatus !== "View") return;
  if (data.stock_movement_status === "Processing") {
    followBackgroundSave(data.id, data.stock_movement_no, data.lot_v2_job_id);
    return;
  }
  const jobId = String(data.lot_v2_job_id || "").trim();
  if (/^[0-9]{1,20}$/.test(jobId) && (data.stock_movement_status === "Draft" || data.stock_movement_status === "In Progress")) {
    showLastBackgroundFailure(data.id, jobId, data.stock_movement_no);
  }
};

(async () => {
  try {
    const data = this.getValues();
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

    this.setData({
      page_status: pageStatus,
      movement_type: "Location Transfer",
    });
    this.disabled(["movement_type"], true);

    switch (pageStatus) {
      case "Add":
        const nickName = this.getVarGlobal("nickname");
        this.setData({
          organization_id: organizationId,
          issued_by: nickName,
          issue_date: new Date().toISOString().split("T")[0],
        });
        this.display(["draft_status", "button_save_as_draft"]);
        this.hide(CONFIG.fields.hide);

        const plantID = setPlant(organizationId, pageStatus);
        this.disabled("stock_movement", plantID === organizationId);
        hideSerialNumberRecordTab();
        configureFields(data.is_production_order);
        configureButtons(pageStatus, null);
        await initMovementReason();
        await setStorageLocation(plantID);
        break;

      case "Edit":
        this.hide(CONFIG.fields.hide);
        setTimeout(() => {
          this.triggerEvent("syncBundleChildButtons");
        }, 100);
        configureFields(data.is_production_order);
        configureButtons(pageStatus, data.stock_movement_status);
        const plantId = data.issuing_operation_faci;

        if (
          data.stock_movement_status === "Completed" ||
          data.stock_movement_status === "Processing"
        ) {
          editDisabledField();
        } else if (data.stock_movement_status === "In Progress") {
          rememberLines(data);
          setTimeout(async () => {
            this.disabled(
              ["issuing_operation_faci", "issue_date", "movement_reason"],
              true,
            );
            await setStorageLocation(plantId);
          }, 100);

          setTimeout(() => {
            const editButtons = document.querySelectorAll(
              ".el-row .el-col.el-col-12.el-col-xs-24 .el-button.el-button--primary.el-button--default.is-link",
            );
            editButtons.forEach((button) => {
              button.style.display = "none";
            });

            // Inject CSS to override hover behavior and keep row numbers visible
            const styleId = "lot-hide-row-actions";
            if (!document.getElementById(styleId)) {
              const style = document.createElement("style");
              style.id = styleId;
              style.textContent = `
                .fm-virtual-table__row-cell .scope-action { display: none !important; }
                .fm-virtual-table__row-cell .scope-index { display: flex !important; }
              `;
              document.head.appendChild(style);
            }
          }, 500);
        } else if (data.stock_movement_status === "Draft") {
          setPlant(organizationId, pageStatus);
        }

        showProductionOrder(data);
        showStatusHTML(data.stock_movement_status);
        hideSerialNumberRecordTab();
        break;

      case "View":
        this.hide(CONFIG.fields.hide);

        configureFields(data.is_production_order);
        configureButtons(pageStatus, data.stock_movement_status);
        showStatusHTML(data.stock_movement_status);
        showProductionOrder(data);
        hideSerialNumberRecordTab();
        break;
    }

    lotBackgroundView(pageStatus, data);
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();

setTimeout(async () => {
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
  var params = this.getComponent("stock_movement_no");
  const { options } = params;

  const optionsData = this.getOptionData("stock_movement_no_type") || [];
  const defaultData = getDefaultItem(optionsData);
  if (options?.canManualInput) {
    this.setOptionData("stock_movement_no_type", [
      { label: "Manual Input", value: -9999 },
      ...optionsData,
    ]);
    if (this.isAdd) {
      this.setData({
        stock_movement_no_type: defaultData ? defaultData.value : -9999,
      });
    }
  } else if (defaultData) {
    if (this.isAdd) {
      this.setData({ stock_movement_no_type: defaultData.value });
    }
  }
}, 200);
