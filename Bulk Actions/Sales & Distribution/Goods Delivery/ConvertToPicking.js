const getPackingSetup = async (organizationId) => {
  try {
    const packingData = await db
      .collection("packing_setup")
      .where({ organization_id: organizationId })
      .get();

    if (!packingData.data || packingData.data.length === 0) {
      return 0;
    }

    return packingData.data[0].packing_required;
  } catch (error) {
    console.error("Error in getPackingSetup:", error);
    return 0;
  }
};

const isFullPickingEnabled = async (organizationId) => {
  try {
    const setupData = await db
      .collection("picking_setup")
      .where({ organization_id: organizationId })
      .get();
    return setupData?.data?.[0]?.allow_full_picking === 1;
  } catch (error) {
    console.error("Error reading allow_full_picking:", error);
    return false;
  }
};

// Build a per-bin "consumed" map from authoritative TO data:
//   { [gd_line_id]: { [`${source_bin}_${batch}_${hu}`]: consumedQty } }
// Sources:
//   - Completed TOs: store_out_qty from table_picking_records (skip Cancelled lines)
//   - Non-Completed, non-Cancelled TOs: qty_to_pick from table_picking_items
// This map drives both the eligibility filter (sum across keys per line) and
// the per-bin subtraction in SplitPickingConfirm.js — single source of truth,
// no reliance on denormalized picked_qty / picked_temp_qty_data fields.
// A few GDs at a time: one read per GD all at once sent 300 requests together
// on a 300-GD convert.
const READ_CONCURRENCY = 6;

const forEachLimited = async (list, limit, fn) => {
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next;
      next += 1;
      await fn(list[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, list.length) }, worker),
  );
};

// One GD's live Pickings: a Completed one counts its records, any other its
// lines. A read naming both subforms makes the server join every line with
// every record (a Picking with 2,000 of each is 4 million rows), so each
// subform is read on its own, classified by the status read taken first.
const readGdPickings = async (gdId) => {
  const query = () => db.collection("transfer_order").where({ gd_no: gdId });
  const heads = (await query().field("id,to_status").get())?.data || [];
  const completed = new Set(
    heads
      .filter((to) => to.to_status === "Completed")
      .map((to) => String(to.id)),
  );
  const open = new Set(
    heads
      .filter((to) => to.to_status !== "Completed" && to.to_status !== "Cancelled")
      .map((to) => String(to.id)),
  );
  const [withRecords, withItems] = await Promise.all([
    completed.size > 0
      ? query().field("id,table_picking_records").get()
      : null,
    open.size > 0 ? query().field("id,table_picking_items").get() : null,
  ]);
  return {
    completed: (withRecords?.data || []).filter((to) =>
      completed.has(String(to.id)),
    ),
    open: (withItems?.data || []).filter((to) => open.has(String(to.id))),
  };
};

const buildConsumedQtyMap = async (gdIds) => {
  const consumed = {};
  if (!Array.isArray(gdIds) || gdIds.length === 0) return consumed;

  const binKeyOf = (loc, batch, hu) =>
    (loc || "no-loc") +
    "_" +
    (batch || "no-batch") +
    "_" +
    (hu || "no-hu");
  const add = (lineId, key, qty) => {
    const lid = String(lineId || "");
    if (!lid) return;
    consumed[lid] = consumed[lid] || {};
    consumed[lid][key] = (consumed[lid][key] || 0) + parseFloat(qty || 0);
  };

  // A Picking covering several of these GDs comes back once per GD; count it once.
  const counted = new Set();
  const firstTime = (to) => !counted.has(String(to.id)) && counted.add(String(to.id));

  // Not caught here: a GD whose Pickings could not be read must stop the
  // conversion, not count as nothing picked.
  await forEachLimited(
    [...new Set(gdIds.map(String))],
    READ_CONCURRENCY,
    async (gdId) => {
      const { completed, open } = await readGdPickings(gdId);
      for (const to of completed.filter(firstTime)) {
        for (const rec of to.table_picking_records || []) {
          if (rec.line_status === "Cancelled") continue;
          add(
            rec.gd_line_id,
            binKeyOf(rec.source_bin, rec.batch_no, rec.handling_unit_id),
            rec.store_out_qty,
          );
        }
      }
      for (const to of open.filter(firstTime)) {
        for (const item of to.table_picking_items || []) {
          if (item.row_type === "header") continue;
          if (item.line_status === "Cancelled") continue;
          const batch = item.batch_no || item.item_batch_id || null;
          add(
            item.gd_line_id,
            binKeyOf(item.source_bin, batch, item.handling_unit_id),
            item.qty_to_pick,
          );
        }
      }
    },
  );

  return consumed;
};

const sumConsumedForLine = (consumedByLine, lineId) => {
  const m = consumedByLine?.[String(lineId)];
  if (!m) return 0;
  let total = 0;
  for (const v of Object.values(m)) total += v;
  return total;
};

const lineRemainingPickable = (gdItem, consumedByLine) =>
  (gdItem.gd_qty || 0) - sumConsumedForLine(consumedByLine, gdItem.id);

const hasPickableLine = (item, fullPickingEnabled, consumedByLine) => {
  if (fullPickingEnabled) {
    return item.table_gd.some(
      (gdItem) =>
        lineRemainingPickable(gdItem, consumedByLine) > 0 &&
        gdItem.picking_status !== "Completed" &&
        gdItem.picking_status !== "Cancelled",
    );
  }
  return item.table_gd.some(
    (gdItem) => gdItem.picking_status === "Not Created",
  );
};

const countPickableLines = (item, fullPickingEnabled, consumedByLine) => {
  if (fullPickingEnabled) {
    return item.table_gd.filter(
      (gdItem) =>
        lineRemainingPickable(gdItem, consumedByLine) > 0 &&
        gdItem.picking_status !== "Completed" &&
        gdItem.picking_status !== "Cancelled",
    ).length;
  }
  return item.table_gd.filter(
    (gdItem) => gdItem.picking_status === "Not Created",
  ).length;
};

const handlePicking = async (selectedRecords) => {
  const uniquePlants = new Set(selectedRecords.map((gd) => gd.plant_id.id));
  const allSamePlant = uniquePlants.size === 1;

  if (!allSamePlant) {
    this.$alert(
      "All selected goods deliveries must be from the same plant to create a single picking.",
      "Error",
      {
        confirmButtonText: "OK",
        type: "error",
      },
    );
    throw new Error(
      "All selected goods deliveries must be from the same plant.",
    );
  }

  const packingRequired = await getPackingSetup(
    selectedRecords[0].organization_id,
  );

  if (packingRequired === 1) {
    const uniqueCustomers = new Set(
      selectedRecords.map((gd) => gd.customer_id),
    );
    const allSameCustomer = uniqueCustomers.size === 1;

    if (!allSameCustomer) {
      this.$alert(
        "All selected goods deliveries must be from the same customer to create a single picking due to packing requirement.",
        "Error",
        {
          confirmButtonText: "OK",
          type: "error",
        },
      );
      throw new Error(
        "All selected goods deliveries must be from the same customer due to packing requirement.",
      );
    }
  }

  this.showLoading("Converting to Picking...");
  await this.runWorkflow(
    "1986262284472963073",
    {
      gd_ids: selectedRecords.map((gd) => gd.id),
      plant_id: selectedRecords[0].plant_id.id,
    },
    async (res) => {
      this.hideLoading();
      const pickingData = res.data.data;
      await this.toView({
        target: "1935556443668959233",
        type: "add",
        data: { ...pickingData },
        position: "rtl",
        mode: "dialog",
        width: "80%",
        title: "Add",
      });
    },
    (err) => {
      this.hideLoading();
      throw err;
    },
  );
};

(async () => {
  try {
    const allListID = "custom_ezwb0qqp";

    let selectedRecords;

    selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (selectedRecords && selectedRecords.length > 0) {
      const fullPickingEnabled = await isFullPickingEnabled(
        selectedRecords[0].organization_id,
      );

      let consumedByLine = {};
      if (fullPickingEnabled) {
        this.showLoading("Checking existing pickings...");
        try {
          consumedByLine = await buildConsumedQtyMap(
            selectedRecords.map((r) => r.id),
          );
        } catch (err) {
          console.error("Error reading existing pickings:", err);
          this.hideLoading();
          await this.$alert(
            "Could not read the existing pickings of the selected goods deliveries. Nothing was converted, please try again.",
            "Conversion Not Started",
            { confirmButtonText: "OK", type: "error" },
          );
          return;
        }
        this.hideLoading();
      }

      selectedRecords = selectedRecords.filter((item) =>
        hasPickableLine(item, fullPickingEnabled, consumedByLine),
      );

      if (selectedRecords.length === 0) {
        await this.$alert(
          fullPickingEnabled
            ? "No selected records have remaining quantity to pick (after accounting for committed picks and in-flight reservations)."
            : "No selected records are available for conversion. Please select records with picking status 'Not Created'.",
          "No Records to Convert",
          {
            confirmButtonText: "OK",
            dangerouslyUseHTMLString: true,
            type: "warning",
          },
        );
        return;
      }

      await this.$confirm(
        `Only these goods delivery records available for conversion. Proceed?<br><br>
  <strong>Selected Records:</strong><br> ${selectedRecords
    .map((item) => {
      const totalItems = item.table_gd.length;
      const pickableItems = countPickableLines(
        item,
        fullPickingEnabled,
        consumedByLine,
      );
      return `${item.delivery_no} (${pickableItems}/${totalItems} items)`;
    })
    .join("<br>")}`,
        "Confirm Conversion",
        {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          dangerouslyUseHTMLString: true,
          type: "info",
        },
      ).catch(() => {
        console.log("User clicked Cancel or closed the dialog");
        throw new Error();
      });

      if (selectedRecords.length > 0) {
        if (fullPickingEnabled) {
          // M:N path: open dialog_split_picking. The dialog's Confirm
          // handler picks up from here (re-fetches GDs, computes groups,
          // drives dialog_assignee N times, creates N TOs directly).
          // All inter-handler state is JSON-stringified into a single
          // `split_state` form-level hidden field.
          const splitState = {
            gd_ids: selectedRecords.map((r) => r.id),
            plant_id:
              selectedRecords[0].plant_id?.id ||
              selectedRecords[0].plant_id ||
              "",
            organization_id: selectedRecords[0].organization_id || "",
            list_component_id: allListID,
            consumed_by_line: consumedByLine,
            groups: [],
            index: 0,
            assignees: [],
          };
          // plant_id is stamped now rather than when dialog_assignee opens: the
          // assignee picker filters on it (dept_id contains plant_id), so it has
          // to be in place before that select resolves its options.
          await this.setData({
            split_state: JSON.stringify(splitState),
            "dialog_assignee.plant_id": splitState.plant_id,
          });
          await this.openDialog("dialog_split_picking");
        } else {
          await handlePicking(selectedRecords);
          await this.getComponent(allListID)?.$refs.crud.clearSelection();
        }
      }
    } else {
      this.$message.error("Please select at least one record.");
    }
  } catch (error) {
    console.error(error);
  }
})();
