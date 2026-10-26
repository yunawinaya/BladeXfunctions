// Helper functions
const showStatusHTML = async (status) => {
  switch (status) {
    case "Draft":
      this.display(["draft_status"]);
      break;
    case "Created":
      this.display(["created_status"]);
      break;
    case "Completed":
      this.display(["completed_status"]);
      break;
    case "Cancelled":
      this.display(["cancelled_status"]);
      break;
    default:
      break;
  }
};

const disabledField = async (status) => {
  // Fields sourced upstream (from GD / SO / Picking) — should stay immutable
  // once the Packing has been created. User should not edit these on Created or Completed.
  const upstreamFields = [
    "plant_id",
    "organization_id",
    "packing_no",
    "packing_no_type",
    "gd_id",
    "gd_no",
    "so_id",
    "so_no",
    "to_id",
    "customer_id",
    "billing_address",
    "shipping_address",
  ];

  if (status === "Completed" || status === "Cancelled") {
    this.disabled(
      [
        ...upstreamFields,
        "packing_status",
        "packing_mode",
        "assigned_to",
        "created_by",
        "created_at",
        "ref_doc",
        "table_hu",
        "remarks",
        "remarks_2",
        "remarks_3",
      ],
      true,
    );
    this.hide(["button_save_as_draft", "button_created", "button_completed"]);
  } else if (status === "Created") {
    this.disabled(upstreamFields, true);
    this.disabled(["ref_doc"], false);
  } else {
    this.disabled(["ref_doc"], false);
  }
};

const setPlant = async (organizationId) => {
  const deptId = this.getVarSystem("deptIds").split(",")[0];
  let plantId = "";
  const plant = this.getValue("plant_id");

  if (!plant) {
    if (deptId === organizationId) {
      const resPlant = await db
        .collection("blade_dept")
        .where({ parent_id: deptId })
        .get();

      if (!resPlant && resPlant.data.length === 0) {
        plantId = deptId;
      } else {
        plantId = "";
      }
    } else {
      plantId = deptId;
    }
  }

  this.setData({
    organization_id: organizationId,
    ...(!plant ? { plant_id: plantId } : {}),
    created_at: new Date().toISOString().split("T")[0],
  });
};

const setPackingMode = async () => {
  const packingMode = this.getValue("packing_mode");
  if (packingMode === "Basic") {
    this.display(["table_hu.hu_quantity"]);
    this.hide(["table_hu.item_count", "table_hu.total_quantity"]);
  } else {
    this.hide(["table_hu.hu_quantity"]);
    this.display(["table_hu.item_count", "table_hu.total_quantity"]);
  }
};

// table_hu_source columns `hu_select` and `handling_unit_id` are visible by
// default in the form schema. This function walks each row and hides them
// on non-header (item) rows so they only appear on HU headers.
const applyHuSourceVisibility = async () => {
  const rows = this.getValue("table_hu_source") || [];
  if (rows.length === 0) return;

  for (let i = 0; i < rows.length; i++) {
    if (rows[i].row_type !== "header") {
      await this.hide(`table_hu_source.${i}.handling_unit_id`);
    }
  }
};

const fetchPickingSetup = async (organizationId) => {
  try {
    const resPickingSetup = await db
      .collection("picking_setup")
      .where({ organization_id: organizationId })
      .get()
      .then((res) => {
        return res.data[0];
      });

    if (!resPickingSetup) {
      console.log("No picking setup found");
      return;
    }

    const pickingAfter = resPickingSetup.picking_after;

    if (pickingAfter === "Sales Order") {
      await this.hide(["gd_id"]);
    }
  } catch (error) {
    console.error(error);
  }
};

// Packing V2: the Packing's latest background completion, read through PACKING_ASYNC_SUBMIT (STATUS: the browser cannot
// read gd_async_job). While it is open the save buttons are hidden and this browser follows it to the end; FAILED / under
// review is reported once. No worker is scheduled on the server, so any open of a Packing without a job of its own also
// starts the worker once without naming a job (at most every 2 minutes in this browser): it takes the oldest due job, so a
// completion whose browser was closed still finishes.
const PKG_V2 = { SUBMIT: "2109924558618333185", WORKER: "2109924593737240578" };
const PKG_V2_OPEN = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_PACKING"];
const pkgV2Run = (workflowId, params) =>
  new Promise((resolve) => {
    try {
      this.runWorkflow(
        workflowId,
        params,
        (res) => resolve((res && res.data) || null),
        (err) => {
          console.error("Packing V2: " + workflowId + " call failed", err);
          resolve(null);
        },
      );
    } catch (e) {
      resolve(null);
    }
  });
// start the worker for the job until it ends or 10 minutes pass; the answer carries no next-attempt time, so a lock retry
// waits the server's backoff (2 s doubling to 30 s), an operation still running 10 s, the hand-over after the stock call
// 1.5 s; a start that did not take the job (not due yet / another run has it) reads the job through STATUS
const pkgV2FollowJob = (jobId, packingId, organizationId, onEnd) => {
  let following = {};
  try {
    following = window.__pkgV2Following = window.__pkgV2Following || {};
  } catch (e) {
    following = {};
  }
  if (following[jobId]) return;
  following[jobId] = 1;
  const until = Date.now() + 10 * 60 * 1000;
  let idle = 0;
  const step = async () => {
    const w = (await pkgV2Run(PKG_V2.WORKER, { job_id: jobId })) || {};
    let st = String(w.job_id || "") === jobId ? String(w.job_status || "") : "";
    let msg = String(w.result_message || "");
    let attempts = 0;
    try {
      attempts = Number((JSON.parse(w.jobs || "[]")[0] || {}).attempt_count) || 0;
    } catch (e) {
      attempts = 0;
    }
    if (!st) {
      const s = (await pkgV2Run(PKG_V2.SUBMIT, { packing_id: packingId, organization_id: organizationId, operation: "STATUS" })) || {};
      if (String(s.job_id || "") === jobId) {
        st = String(s.job_status || "");
        msg = String(s.result_message || msg);
      }
      idle += 1;
    } else idle = 0;
    if (st && PKG_V2_OPEN.indexOf(st) < 0) {
      delete following[jobId];
      return onEnd(st, msg);
    }
    if (Date.now() > until) {
      delete following[jobId];
      return;
    }
    const code = String(w.result_code || "");
    const wait = code === "PK_INVENTORY_IN_PROGRESS" ? 10000 : /RETRY/.test(code) ? Math.min(30000, 2000 * Math.pow(2, Math.max(0, attempts - 1))) + 500 : idle ? Math.min(30000, 3000 * idle) : 1500;
    setTimeout(step, wait);
  };
  step();
};
const pkgV2Drain = () => {
  try {
    if (Date.now() - (Number(window.localStorage.getItem("pkgv2_drain_at")) || 0) < 120000) return;
    window.localStorage.setItem("pkgv2_drain_at", String(Date.now()));
  } catch (e) {
    // storage blocked: started anyway
  }
  pkgV2Run(PKG_V2.WORKER, {});
};
const pkgV2ShowJobState = async () => {
  const id = this.getValue("id");
  if (!id || PKG_V2.SUBMIT.indexOf("__") === 0) return;
  let organizationId = String(this.getValue("organization_id") || "");
  if (!organizationId) {
    organizationId = String(this.getVarGlobal("deptParentId") || "");
    if (!organizationId || organizationId === "0") organizationId = String(this.getVarSystem("deptIds") || "").split(",")[0];
  }
  const job = await pkgV2Run(PKG_V2.SUBMIT, { packing_id: String(id), organization_id: organizationId, operation: "STATUS" });
  if (!job || !job.job_id) return pkgV2Drain();
  const seenKey = "pkgv2_seen_" + job.job_id;
  const markSeen = () => {
    try {
      window.localStorage.setItem(seenKey, "1");
    } catch (e) {
      // storage blocked: reported again on the next open
    }
  };
  if (PKG_V2_OPEN.includes(job.job_status)) {
    this.hide(["button_save_as_draft", "button_created", "button_completed"]);
    this.$message.warning("This Packing is being completed in the background (" + (job.result_message || job.job_status) + "). Reopen it in a moment.");
    pkgV2FollowJob(String(job.job_id), String(id), organizationId, (st, msg) => {
      markSeen();
      if (st === "COMPLETED") this.$message.success("The Packing was completed in the background. Reopen it to see it.");
      else if (st === "FAILED") this.$message.error("The last completion was not saved: " + (msg || "unknown reason"));
      else if (st === "REQUIRES_REVIEW") this.$message.error("The last completion stopped half-way and is under review: " + msg + " Please contact support.");
    });
    return;
  }
  pkgV2Drain();
  let seen = false;
  try {
    seen = window.localStorage.getItem(seenKey) === "1";
  } catch (e) {
    seen = false;
  }
  markSeen();
  if (seen) return;
  if (job.job_status === "FAILED") this.$message.error("The last completion was not saved: " + (job.result_message || "unknown reason"));
  else if (job.job_status === "REQUIRES_REVIEW") this.$message.error("The last completion stopped half-way and is under review: " + job.result_message + " Please contact support.");
};

// Main execution function
(async () => {
  try {
    let pageStatus = "";
    const status = await this.getValue("packing_status");
    console.log("Debug", this.getValues());

    if (this.isAdd) pageStatus = "Add";
    else if (this.isEdit) pageStatus = "Edit";
    else if (this.isView) pageStatus = "View";
    else throw new Error("Invalid page state");

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    this.setData({ page_status: pageStatus });

    switch (pageStatus) {
      case "Add":
        // Add mode
        this.display(["draft_status"]);
        this.disabled("assigned_to", false);
        this.setData({
          created_by: this.getVarGlobal("nickname"),
        });

        setPlant(organizationId);

        await setPackingMode();
        await fetchPickingSetup(organizationId);
        break;

      case "Edit":
        if (status !== "Draft") {
          this.hide(["button_save_as_draft"]);
          await fetchPickingSetup(organizationId);
        }
        await disabledField(status);
        await showStatusHTML(status);
        await setPackingMode();
        pkgV2ShowJobState();
        break;

      case "View":
        await showStatusHTML(status);
        this.hide([
          "button_save_as_draft",
          "button_created",
          "button_completed",
        ]);
        await setPackingMode();
        pkgV2ShowJobState();
        break;
    }

    await this.triggerEvent("PackingRecomputeSource");
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();

// Per-row visibility for table_hu_source needs the table data to be loaded
// before display/hide can target specific rows. Run after a delay.
setTimeout(async () => {
  if (this.isAdd) return;
  await applyHuSourceVisibility();
}, 500);

setTimeout(async () => {
  if (!this.isAdd) return;
  const maxRetries = 10;
  const interval = 500;
  for (let i = 0; i < maxRetries; i++) {
    const op = await this.onDropdownVisible("packing_no_type", true);
    if (op != null) break;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  function getDefaultItem(arr) {
    return arr?.find((item) => item?.item?.is_default === 1);
  }

  const optionsData = this.getOptionData("packing_no_type") || [];
  const data = getDefaultItem(optionsData);
  if (data) {
    this.setData({ packing_no_type: data.value });
  }
}, 500);
