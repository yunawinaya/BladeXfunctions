// Confirm handler wired to dialog_assignee's Confirm button.
// Captures the assignee for the current group, then either advances to the
// next group (re-populating the dialog) or, on the last group, runs the
// finalize routine: create N transfer_orders, update affected GDs, refresh
// the list. State lives on form-level hidden fields populated by
// ConvertToPicking.js / SplitPickingConfirm.js.

const getPickingNoType = async (organizationId) => {
  try {
    const res = await db
      .collection("su_code_serial_no_rule")
      .where({
        department_id: organizationId,
        business_type: "Picking",
        is_default: 1,
      })
      .get();
    return res?.data?.[0]?.id || null;
  } catch (err) {
    console.error("Error reading picking prefix:", err);
    return null;
  }
};

// Build N picking payloads (one per group) and run PickingLoopWorkflow with
// arrayData. The workflow handles: prefix generation (to_id auto-fill),
// required-field validation, the actual transfer_order add, and the GD
// picking_status writeback (only bumps Not Created / null lines to Created;
// leaves In Progress / Completed alone — M:N safe).
const finalize = async (
  groups,
  assignees,
  plantId,
  organizationId,
  listComponentId,
) => {
  const pickingNoType = await getPickingNoType(organizationId);
  const nowMysql = new Date().toISOString().slice(0, 19).replace("T", " ");
  const createdBy =
    typeof this !== "undefined" && this.getVarGlobal
      ? this.getVarGlobal("nickname")
      : "";

  const arrayData = groups.map((group, i) => {
    const assignee = assignees[i] || [];
    return {
      to_status: "Created",
      to_id: "",
      to_id_type: pickingNoType,
      plant_id: plantId,
      organization_id: organizationId,
      movement_type: "Picking",
      ref_doc_type: "Goods Delivery",
      gd_no: group.gd_ids,
      delivery_no: group.delivery_no,
      so_no: group.so_no,
      customer_id: group.customer_id,
      ref_doc: group.ref_doc,
      assigned_to: Array.isArray(assignee) ? assignee : [assignee],
      table_picking_items: group.table_picking_items,
      created_by: createdBy,
      created_at: nowMysql,
      remarks: "",
      to_no: [],
      table_picking_records: [],
      is_processing: 0,
    };
  });

  let workflowResult;
  await this.runWorkflow(
    "2021065804251615233",
    { arrayData, saveAs: "Created", pageStatus: "Add" },
    (res) => {
      workflowResult = res;
    },
    (err) => {
      console.error("Picking workflow error:", err);
      workflowResult = err;
    },
  );

  if (!workflowResult || !workflowResult.data) {
    this.$message.error("No response from picking workflow");
    return;
  }

  const code = workflowResult.data.code;
  if (code === "400" || code === 400 || workflowResult.data.success === false) {
    const msg =
      workflowResult.data.msg ||
      workflowResult.data.message ||
      "Failed to create pickings";
    this.$message.error(msg);
    return;
  }

  if (code === "200" || code === 200 || workflowResult.data.success === true) {
    this.$message.success(
      `Successfully created ${groups.length} picking record(s).`,
    );
    if (listComponentId) {
      try {
        this.getComponent(listComponentId)?.$refs?.crud?.clearSelection?.();
      } catch (e) {
        // ignore
      }
    }
    this.refresh && this.refresh();
  } else {
    this.$message.error("Unknown workflow status");
  }
};

(async () => {
  try {
    const stateRaw = await this.getValue("split_state");
    const state = stateRaw ? JSON.parse(stateRaw) : {};
    const groups = Array.isArray(state.groups) ? state.groups : [];
    let index = Number.isFinite(state.index) ? state.index : 0;
    const assignees = Array.isArray(state.assignees) ? state.assignees : [];

    if (groups.length === 0) {
      this.$message.error(
        "No picking groups found. Please restart the conversion.",
      );
      await this.closeDialog("dialog_assignee");
      return;
    }

    // Assignee is optional — empty = unassigned picking.
    const rawAssignee = await this.getValue("dialog_assignee.assignee");
    const currentAssignee = Array.isArray(rawAssignee)
      ? rawAssignee
      : rawAssignee
        ? [rawAssignee]
        : [];

    assignees[index] = currentAssignee;
    const nextIndex = index + 1;

    if (nextIndex < groups.length) {
      // Advance to next group: persist state, repopulate dialog, keep open.
      state.assignees = assignees;
      state.index = nextIndex;
      await this.setData({
        split_state: JSON.stringify(state),
        "dialog_assignee.area_name": groups[nextIndex].key,
        "dialog_assignee.assignee": [],
      });
      // Dialog is already open; setData refreshes its visible state.
    } else {
      // Last group — finalize.
      state.assignees = assignees;
      await this.setData({ split_state: JSON.stringify(state) });

      const plantId = state.plant_id || "";
      const organizationId = state.organization_id || "";
      const listComponentId = state.list_component_id || "";

      await this.closeDialog("dialog_assignee");
      this.showLoading("Creating pickings...");
      try {
        await finalize(
          groups,
          assignees,
          plantId,
          organizationId,
          listComponentId,
        );
      } finally {
        this.hideLoading();
        // Clear state for next run.
        await this.setData({
          split_state: "",
        });
      }
    }
  } catch (error) {
    console.error("SplitPickingAssigneeConfirm error:", error);
    this.$message.error(
      error.message || "Failed to assign and create pickings.",
    );
  }
})();
