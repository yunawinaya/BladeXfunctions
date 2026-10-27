// Auto Pick & Complete - bulk action on the Goods Delivery flow Picking list.
//
// Fills every outstanding line to its full remaining quantity and completes the
// Picking down the ORDINARY save path. Deliberately does NOT pass isForceComplete:
// that flag suppresses record creation and rewrites the GD down to what was picked,
// which is the opposite of this action. Here the GD quantity is preserved and the
// picking_setup.auto_completed_gd cascade decides whether the GD completes too.
//
// Not to be confused with picking_setup.allow_full_picking ("Full Picking"), which
// closes a partly picked line and splits the remainder into a new Picking.

// Picking V2 (2026-10-12): each Picking is first offered to the background save (PICKING_ASYNC_SUBMIT, operation
// PICK_ALL_REMAINING: the server fills every open line from the stored document); a Picking it does not handle yet
// (NOT_ELIGIBLE) takes the classic path below unchanged. The workflow ids are dev ids.
const PK_V2_WF = {
  SUBMIT: "2109531449614647297",
  WORKER: "2109531412499251201",
};
const ASYNC_PICKING_ENABLED = true;

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

// Auto Complete GD (stage 1e): COMMIT hands each delivery this confirm left fully picked to GD Complete V2. The screen follows the
// job through STATUS - not the worker's answer, which a long run can lose in the browser (Kenhin 10-27) - and starts each queued
// completion once (GD_COMPLETE_WORKER, one call per job). P7 adds its entries just after the job is COMPLETED, so the follow stays
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
const followGdCompletes = async (pickingId, organizationId) => {
  const run = this.runWorkflow.bind(this);
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
    for (const g of fresh) {
      started[g.job_id] = 1;
      try {
        run(PK_V2_GD_COMPLETE_WORKER, { job_id: String(g.job_id) }, () => {}, (e) => console.error("GD Complete V2: start failed - the lists' sweep picks it up", e));
      } catch (e) {
        console.error("GD Complete V2: could not be started", e);
      }
    }
    if (fresh.length) msg.success("Completing " + fresh.map((g) => g.gd_no || g.gd_id).join(", ") + " in the background.");
    const waiting = list.filter((g) => g && g.status === "NOT_QUEUED" && !named[g.gd_id]);
    for (const g of waiting) named[g.gd_id] = 1;
    if (waiting.length) msg.warning("Not completed automatically: " + waiting.map((g) => (g.gd_no || g.gd_id) + " - " + (g.message || g.code)).join("; "));
    stable = list.length === lastSize ? stable + 1 : 0;
    lastSize = list.length;
    if (stable >= 3) return;
  }
};

const runPickingWorkflow = async (data) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      "2021065804251615233",
      {
        arrayData: [data],
        saveAs: "Completed",
        pageStatus: "Edit",
        confirmed_by: this.getVarGlobal("nickname"),
      },
      (res) => {
        console.log("Picking workflow response:", res);
        resolve(res);
      },
      (err) => {
        console.error("Failed to auto pick Picking:", err);
        reject(err);
      },
    );
  });
};

const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

// picked_qty is expressed in the row's picking_uom, while pending_process_qty is
// canonical (order UOM). code_node_oHIIKfiw scales the submitted quantity by
// picking_base_qty / order_base_qty, so invert exactly that factor. Both sides
// fall back to 1 when the scalars are missing, making this an identity for the
// rows that never opted into an alternate Pick UOM.
const toPickingUom = (pending, row) => {
  const orderBase = Number(row.order_base_qty) || 1;
  const pickBase = Number(row.picking_base_qty) || orderBase;
  return round3((pending * orderBase) / pickBase);
};

const isBundleParent = (row) => !!row.item_bundle_id && !row.item_code;

// table_picking_items is a tree: an item bundle is ONE row with its items as
// `children`. Returns the rewritten rows plus a count of rows that will actually
// produce a picking record.
const fillRows = (rows) => {
  const out = [];
  let pickable = 0;

  for (const row of rows || []) {
    // Display-only HU header rows carry no stock. The form strips them before
    // saving; left in with a picked_qty they would generate a bogus record.
    if (row.row_type === "header") continue;

    const next = { ...row };

    if (Array.isArray(row.children) && row.children.length > 0) {
      const child = fillRows(row.children);
      next.children = child.rows;
      pickable += child.pickable;
    }

    if (row.line_status === "Cancelled") {
      out.push(next);
      continue;
    }

    const pending = parseFloat(row.pending_process_qty) || 0;
    next.picked_qty = pending > 0 ? toPickingUom(pending, row) : 0;

    // A bundle parent never produces a record, but it is still filled: the loop
    // workflow's "at least one picked qty" gate only inspects the TOP level, so an
    // all-bundle Picking would otherwise be rejected as having nothing picked.
    if (next.picked_qty > 0 && !isBundleParent(next)) pickable += 1;

    out.push(next);
  }

  return { rows: out, pickable };
};

(async () => {
  try {
    this.showLoading();
    const allListID = "custom_41s73hyl";

    const selectedRecords =
      this.getComponent(allListID)?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (!selectedRecords || selectedRecords.length === 0) {
      this.hideLoading();
      this.$message.error("Please select at least one record.");
      return;
    }

    const pickingData = selectedRecords.filter(
      (item) =>
        item.to_status === "Created" || item.to_status === "In Progress",
    );

    if (pickingData.length === 0) {
      this.$message.error(
        "Please select at least one created or in progress picking.",
      );
      this.hideLoading();
      return;
    }

    const pickingNumbers = pickingData.map((item) => item.to_id);
    const inProgressCount = pickingData.filter(
      (item) => item.to_status === "In Progress",
    ).length;

    // One org-scoped read so the confirm can say whether the deliveries complete
    // too. Scoped by organization_id alone, matching the workflow's own lookup.
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }
    const setupRes = await db
      .collection("picking_setup")
      .where({ organization_id: organizationId })
      .get();
    const autoCompleteGd =
      setupRes?.data?.length > 0 && setupRes.data[0].auto_completed_gd === 1;

    const gdNote = autoCompleteGd
      ? "The linked Goods Delivery will also be completed (Auto Complete GD is on)."
      : "The linked Goods Delivery will stay at Created (Auto Complete GD is off).";
    const partialNote =
      inProgressCount > 0
        ? `<br>${inProgressCount} of them are already part picked - only the remaining quantity will be added.`
        : "";

    await this.$confirm(
      `You've selected ${pickingNumbers.length} picking(s) to auto pick and complete. <br> <strong>Picking Numbers:</strong> <br>${pickingNumbers.join(
        ", ",
      )} <br><br>Every outstanding line will be picked in full from its allocated bin and batch, and the picking will be completed.${partialNote}<br><br>${gdNote}<br><br>Do you want to proceed?`,
      "Auto Pick & Complete",
      {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      console.log("User clicked Cancel or closed the dialog");
      throw new Error();
    });

    const results = [];

    for (const pickingItem of pickingData) {
      const id = pickingItem.id;

      if (ASYNC_PICKING_ENABLED && PK_V2_WF.SUBMIT.indexOf("__") !== 0) {
        const key = "PKA-" + id + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const params = { picking_id: String(id), organization_id: String(pickingItem.organization_id || organizationId), operation: "PICK_ALL_REMAINING", idempotency_key: key, payload: "{}", confirmed_by: this.getVarGlobal("nickname") || "" };
        let sub = await pkV2Call(PK_V2_WF.SUBMIT, params);
        if (!sub.ok) sub = await pkV2Call(PK_V2_WF.SUBMIT, params);
        if (!sub.ok) {
          results.push({ to_id: pickingItem.to_id, success: false, error: "The save request did not complete (" + sub.error + ")" });
          continue;
        }
        if (sub.data.route !== "NOT_ELIGIBLE") {
          if (String(sub.data.result_code) === "200" && sub.data.job_id) {
            results.push({ to_id: pickingItem.to_id, success: true, queued: true });
            followGdCompletes(id, pickingItem.organization_id || organizationId);
            try {
              this.runWorkflow(PK_V2_WF.WORKER, { job_id: String(sub.data.job_id) }, () => {
                this.refresh();
                this.hide("tabs_picking");
              }, (e) => console.error("Picking V2: worker start failed", e));
            } catch (e) {
              console.error("Picking V2: worker could not be started", e);
            }
          } else {
            results.push({ to_id: pickingItem.to_id, success: false, error: sub.data.result_message || "Failed to auto pick Picking" });
          }
          continue;
        }
      }

      const data = await db.collection("transfer_order").doc(id).get();
      const doc = Array.isArray(data?.data) ? data.data[0] : data?.data;

      if (!doc) {
        results.push({
          to_id: pickingItem.to_id,
          success: false,
          error: "Picking record not found",
        });
        continue;
      }

      const filled = fillRows(doc.table_picking_items);

      if (filled.pickable === 0) {
        results.push({
          to_id: pickingItem.to_id,
          success: false,
          error: "Nothing left to pick",
        });
        continue;
      }

      doc.table_picking_items = filled.rows;

      try {
        const workflowResult = await runPickingWorkflow(doc);

        if (!workflowResult || !workflowResult.data) {
          results.push({
            to_id: pickingItem.to_id,
            success: false,
            error: "No response from workflow",
          });
          continue;
        }

        const resultCode = String(workflowResult.data.code);
        const resultMessage =
          workflowResult.data.msg || workflowResult.data.message || "";

        // The Picking is written before the GD cascade runs, so a code raised by
        // the Goods Delivery means "picking completed, delivery did not".
        if (resultCode === "402" || resultCode === "403") {
          results.push({
            to_id: pickingItem.to_id,
            success: true,
            warning: "Credit Limit - GD not auto-completed",
          });
          continue;
        }

        if (resultCode === "407") {
          results.push({
            to_id: pickingItem.to_id,
            success: true,
            warning: "Packing not completed - GD not auto-completed",
          });
          continue;
        }

        if (resultCode === "400" || workflowResult.data.success === false) {
          results.push({
            to_id: pickingItem.to_id,
            success: false,
            error: resultMessage || "Failed to auto pick Picking",
          });
          continue;
        }

        if (resultCode === "200" || workflowResult.data.success === true) {
          results.push({ to_id: pickingItem.to_id, success: true });
          continue;
        }

        // Any other gate the delivery raised: the picking itself still completed.
        results.push({
          to_id: pickingItem.to_id,
          success: true,
          warning: resultMessage || `GD not auto-completed (${resultCode})`,
        });
      } catch (error) {
        results.push({
          to_id: pickingItem.to_id,
          success: false,
          error: error.message || "Failed to auto pick",
        });
      }
    }

    const queuedCount = results.filter((r) => r.queued).length;
    const successCount = results.filter((r) => r.success && !r.warning && !r.queued).length;
    const warningCount = results.filter((r) => r.success && r.warning).length;
    const failCount = results.filter((r) => !r.success).length;
    const queuedNote = queuedCount > 0 ? `${queuedCount} saving in the background, ` : "";

    if (failCount > 0) {
      const failedItems = results
        .filter((r) => !r.success)
        .map((r) => `${r.to_id}: ${r.error}`)
        .join("<br>");
      this.$message.error(
        `${successCount} succeeded, ${queuedNote}${warningCount} with warnings, ${failCount} failed:<br>${failedItems}`,
      );
    } else if (warningCount > 0) {
      const warningItems = results
        .filter((r) => r.warning)
        .map((r) => `${r.to_id}: ${r.warning}`)
        .join("<br>");
      this.$message.warning(
        `${successCount} succeeded, ${queuedNote}${warningCount} with warnings:<br>${warningItems}`,
      );
    } else if (queuedCount > 0) {
      this.$message.success(
        `${queuedCount} Picking(s) submitted and being saved in the background` +
          (successCount > 0 ? `, ${successCount} completed` : "") +
          ". Reopen them in a moment to see the result.",
      );
    } else {
      this.$message.success(
        `All ${successCount} Picking(s) auto picked and completed successfully`,
      );
    }

    this.hideLoading();
    this.refresh();
    this.hide("tabs_picking");
  } catch (error) {
    this.hideLoading();
    console.error(error);
  }
})();
