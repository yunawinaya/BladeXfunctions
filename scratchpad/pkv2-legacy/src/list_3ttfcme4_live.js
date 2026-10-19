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

    const successCount = results.filter((r) => r.success && !r.warning).length;
    const warningCount = results.filter((r) => r.success && r.warning).length;
    const failCount = results.filter((r) => !r.success).length;

    if (failCount > 0) {
      const failedItems = results
        .filter((r) => !r.success)
        .map((r) => `${r.to_id}: ${r.error}`)
        .join("<br>");
      this.$message.error(
        `${successCount} succeeded, ${warningCount} with warnings, ${failCount} failed:<br>${failedItems}`,
      );
    } else if (warningCount > 0) {
      const warningItems = results
        .filter((r) => r.warning)
        .map((r) => `${r.to_id}: ${r.warning}`)
        .join("<br>");
      this.$message.warning(
        `${successCount} succeeded, ${warningCount} with warnings:<br>${warningItems}`,
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
