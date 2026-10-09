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

// Carry the GD's delivery method + details onto each picking, mirroring the
// Map Picking Data node in gdPicking_workflow.json. GD and Picking name some
// fields differently, so Company Truck / Shipping values are remapped into
// Picking's ct_* / ss_* fields. Header remarks already travel on the group.
const DELIVERY_FIELD_KEYS = [
  "delivery_method", "delivery_method_text", "area_id",
  "driver_name", "ic_no", "driver_contact_no", "sp_vehicle_no", "pickup_date", "validity_of_collection",
  "courier_company", "shipping_date", "tracking_number", "est_arrival_date", "freight_charges",
  "ct_driver_name", "ct_driver_contact_no", "ct_ic_no", "vehicle_no", "est_delivery_date", "delivery_cost",
  "shipping_company", "ss_shipping_date", "ss_freight_charges", "shipping_method", "ss_est_arrival_date", "ss_tracking_number",
  "tpt_vehicle_number", "tpt_transport_name", "tpt_ic_no", "tpt_driver_contact_no", "tpt_driver_name",
  "di_shipping_method", "di_driver_name", "di_ic_no", "di_driver_contact_no", "di_shipping_company", "di_transport_name", "di_vehicle_number", "di_est_delivery_date", "di_est_arrival_date", "di_pickup_date", "di_validity_of_collection", "di_tracking_number", "di_freight_charges",
];

const buildDeliveryFields = (gd) => {
  const fields = {};
  for (const k of DELIVERY_FIELD_KEYS) fields[k] = "";
  if (!gd) return fields;

  const method = gd.gd_delivery_method || "";
  fields.delivery_method = method;
  fields.delivery_method_text = gd.delivery_method_text || method;
  fields.area_id = gd.gd_area_id || "";

  // Consolidated Delivery Info block. GD and Picking share these column names,
  // so no remap is needed and they copy straight across.
  fields.di_shipping_method = gd.di_shipping_method ?? "";
  fields.di_driver_name = gd.di_driver_name ?? "";
  fields.di_ic_no = gd.di_ic_no ?? "";
  fields.di_driver_contact_no = gd.di_driver_contact_no ?? "";
  fields.di_shipping_company = gd.di_shipping_company ?? "";
  fields.di_transport_name = gd.di_transport_name ?? "";
  fields.di_vehicle_number = gd.di_vehicle_number ?? "";
  fields.di_est_delivery_date = gd.di_est_delivery_date ?? "";
  fields.di_est_arrival_date = gd.di_est_arrival_date ?? "";
  fields.di_pickup_date = gd.di_pickup_date ?? "";
  fields.di_validity_of_collection = gd.di_validity_of_collection ?? "";
  fields.di_tracking_number = gd.di_tracking_number ?? "";
  fields.di_freight_charges = gd.di_freight_charges ?? "";

  switch (method) {
    case "Self Pickup":
      fields.driver_name = gd.driver_name ?? "";
      fields.ic_no = gd.ic_no ?? "";
      fields.driver_contact_no = gd.driver_contact_no ?? "";
      fields.sp_vehicle_no = gd.sp_vehicle_no ?? "";
      fields.pickup_date = gd.pickup_date ?? "";
      fields.validity_of_collection = gd.validity_of_collection ?? "";
      break;
    case "Courier Service":
      fields.courier_company = gd.courier_company ?? "";
      fields.shipping_date = gd.shipping_date ?? "";
      fields.tracking_number = gd.tracking_number ?? "";
      fields.est_arrival_date = gd.est_arrival_date ?? "";
      fields.freight_charges = gd.freight_charges ?? "";
      break;
    case "Company Truck":
      fields.ct_driver_name = gd.driver_name ?? "";
      fields.ct_driver_contact_no = gd.driver_contact_no ?? "";
      fields.ct_ic_no = gd.ic_no ?? "";
      fields.vehicle_no = gd.vehicle_no ?? "";
      fields.est_delivery_date = gd.est_delivery_date ?? "";
      fields.delivery_cost = gd.delivery_cost ?? "";
      break;
    case "Shipping Service":
      fields.shipping_company = gd.shipping_company ?? "";
      fields.ss_shipping_date = gd.shipping_date ?? "";
      fields.ss_freight_charges = gd.freight_charges ?? "";
      fields.shipping_method = gd.shipping_method ?? "";
      fields.ss_est_arrival_date = gd.est_arrival_date ?? "";
      fields.ss_tracking_number = gd.tracking_number ?? "";
      break;
    case "3rd Party Transporter":
      fields.tpt_vehicle_number = gd.tpt_vehicle_number ?? "";
      fields.tpt_transport_name = gd.tpt_transport_name ?? "";
      fields.tpt_ic_no = gd.tpt_ic_no ?? "";
      fields.tpt_driver_contact_no = gd.tpt_driver_contact_no ?? "";
      fields.tpt_driver_name = gd.tpt_driver_name ?? "";
      break;
  }
  return fields;
};

// A group spanning several GDs keeps each field only where every GD agrees on
// it -- e.g. two GDs both on "Self Pickup" with the same driver carry both across,
// while a field they differ on is left empty rather than taken from one of them.
const buildGroupDeliveryFields = (gds) => {
  const perGd = gds.map((gd) => buildDeliveryFields(gd));
  const fields = buildDeliveryFields(null);
  if (perGd.length === 0) return fields;

  for (const k of DELIVERY_FIELD_KEYS) {
    const first = perGd[0][k];
    if (perGd.every((f) => String(f[k] ?? "") === String(first ?? ""))) {
      fields[k] = first;
    }
  }
  return fields;
};

// The groups in split_state carry only GD ids, not the header delivery fields,
// so every source GD is fetched here, keyed by id.
const getSourceGds = async (gdIds) => {
  const gdById = {};
  if (gdIds.length === 0) return gdById;

  try {
    const res = await db
      .collection("goods_delivery")
      .filter([
        {
          type: "branch",
          operator: "all",
          children: [
            {
              prop: "id",
              operator: "in",
              value: gdIds,
            },
          ],
        },
      ])
      .get();
    for (const gd of res?.data || []) gdById[String(gd.id)] = gd;
  } catch (err) {
    console.error("Error reading goods deliveries for delivery fields:", err);
  }
  return gdById;
};

// Fresh per-GD-line consumed qty, same rules as buildConsumedQtyMap in
// ConvertToPicking.js. Not caught: a failed read must stop the conversion.
const getConsumedTotals = async (gdIds) => {
  const totals = {};
  const add = (lineId, qty) => {
    const lid = String(lineId || "");
    if (!lid) return;
    totals[lid] = (totals[lid] || 0) + parseFloat(qty || 0);
  };

  await Promise.all(
    gdIds.map(async (gdId) => {
      const toResult = await db
        .collection("transfer_order")
        .where({ gd_no: gdId })
        .field("to_status,table_picking_items,table_picking_records")
        .get();
      for (const to of toResult?.data || []) {
        if (to.to_status === "Cancelled") continue;

        if (to.to_status === "Completed") {
          for (const rec of to.table_picking_records || []) {
            if (rec.line_status === "Cancelled") continue;
            add(rec.gd_line_id, rec.store_out_qty);
          }
        } else {
          for (const item of to.table_picking_items || []) {
            if (item.row_type === "header") continue;
            if (item.line_status === "Cancelled") continue;
            add(item.gd_line_id, item.qty_to_pick);
          }
        }
      }
    }),
  );

  return totals;
};

// GD numbers whose lines in this run gained consumed qty since the bulk action
// read them — i.e. another user converted them in the meantime.
const findClaimedSinceStart = (groups, staleByLine, freshTotals) => {
  const claimed = new Set();
  for (const group of groups) {
    for (const item of group.table_picking_items || []) {
      if (item.row_type === "header") continue;
      const lid = String(item.gd_line_id || "");
      if (!lid) continue;
      const stale = Object.values(staleByLine?.[lid] || {}).reduce(
        (sum, v) => sum + (parseFloat(v) || 0),
        0,
      );
      if ((freshTotals[lid] || 0) - stale > 1e-6) {
        claimed.add(item.gd_no || lid);
      }
    }
  }
  return [...claimed];
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
  consumedByLine,
) => {
  const gdIds = [
    ...new Set(
      groups.flatMap((g) =>
        Array.isArray(g.gd_ids) ? g.gd_ids.filter(Boolean).map(String) : [],
      ),
    ),
  ];

  let pickingNoType;
  let gdById;
  let freshConsumed;
  try {
    [pickingNoType, gdById, freshConsumed] = await Promise.all([
      getPickingNoType(organizationId),
      getSourceGds(gdIds),
      getConsumedTotals(gdIds),
    ]);
  } catch (err) {
    console.error("Error re-checking existing pickings:", err);
    this.hideLoading();
    await this.$alert(
      "Could not verify existing pickings for the selected goods deliveries. No picking was created, please try again.",
      "Conversion Not Completed",
      { confirmButtonText: "OK", type: "error" },
    ).catch(() => {});
    return;
  }

  const claimedGdNos = findClaimedSinceStart(
    groups,
    consumedByLine,
    freshConsumed,
  );
  if (claimedGdNos.length > 0) {
    this.hideLoading();
    await this.$alert(
      `${claimedGdNos.join(", ")} ${claimedGdNos.length > 1 ? "were" : "was"} converted to Picking by another user while you were assigning. No picking was created. Please convert again to pick any remaining quantity.`,
      "Already Converted",
      { confirmButtonText: "OK", type: "warning" },
    ).catch(() => {});
    this.refresh && this.refresh();
    return;
  }

  const nowMysql = new Date().toISOString().slice(0, 19).replace("T", " ");
  const createdBy =
    typeof this !== "undefined" && this.getVarGlobal
      ? this.getVarGlobal("nickname")
      : "";

  const arrayData = groups.map((group, i) => {
    const assignee = assignees[i] || [];
    // A GD that failed to load is skipped rather than blanking the group.
    const sourceGds = (Array.isArray(group.gd_ids) ? group.gd_ids : [])
      .map((id) => gdById[String(id)])
      .filter(Boolean);
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
      // Zone/area code the group was split on ("All" when split=no_split);
      // same value dialog_assignee.area_name shows read-only for this group.
      area_name: group.key,
      assigned_to: Array.isArray(assignee) ? assignee : [assignee],
      table_picking_items: group.table_picking_items,
      created_by: createdBy,
      created_at: nowMysql,
      remarks: group.remarks || "",
      remarks_2: group.remarks_2 || "",
      remarks_3: group.remarks_3 || "",
      ...buildGroupDeliveryFields(sourceGds),
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
          state.consumed_by_line || {},
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
