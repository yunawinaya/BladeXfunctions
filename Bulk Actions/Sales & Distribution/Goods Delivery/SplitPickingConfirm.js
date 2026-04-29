// Confirm handler wired to dialog_split_picking's Confirm button.
// Picks up state stashed by ConvertToPicking.js, computes either a single
// "ALL" group (no_split) or N zone-based groups (by_area), then opens
// dialog_assignee for the first group. SplitPickingAssigneeConfirm.js takes
// over from there, walking the user through each group sequentially.

const subtractPickedFromTemp = (gdItem) => {
  let tempArr = [];
  try {
    tempArr = gdItem.temp_qty_data ? JSON.parse(gdItem.temp_qty_data) : [];
  } catch (e) {
    tempArr = [];
  }

  let pickedArr = [];
  try {
    pickedArr = gdItem.picked_temp_qty_data
      ? JSON.parse(gdItem.picked_temp_qty_data)
      : [];
  } catch (e) {
    pickedArr = [];
  }

  if (!Array.isArray(tempArr) || tempArr.length === 0) return [];
  if (!Array.isArray(pickedArr) || pickedArr.length === 0) return tempArr;

  const keyOf = (e) =>
    (e.location_id || "no-loc") +
    "_" +
    (e.batch_id || "no-batch") +
    "_" +
    (e.handling_unit_id || "no-hu");

  const pickedByKey = new Map();
  for (const p of pickedArr) {
    const k = keyOf(p);
    pickedByKey.set(
      k,
      (pickedByKey.get(k) || 0) + parseFloat(p.gd_quantity || 0),
    );
  }

  const remaining = [];
  for (const t of tempArr) {
    const used = pickedByKey.get(keyOf(t)) || 0;
    const rem = parseFloat(t.gd_quantity || 0) - used;
    if (rem > 0) {
      remaining.push({ ...t, gd_quantity: rem });
    }
  }
  return remaining;
};

// Build a picking-item array for one group, mirroring the grouping +
// HU-header injection logic in GDconvertToPicking.json:code_node_PYFZeGpr.
const buildTablePickingItems = (entries) => {
  const groups = new Map();

  for (const { gd, line, tempItem } of entries) {
    const materialId = String(tempItem.material_id || line.material_id || "");
    const groupKey =
      `${line.id}_${materialId}_` +
      `${tempItem.batch_id || "no-batch"}_` +
      `${tempItem.location_id}_` +
      `${tempItem.handling_unit_id || "no-hu"}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        item_code: materialId,
        item_name: line.material_name,
        item_desc: line.gd_material_desc || "",
        batch_no: tempItem.batch_id ? String(tempItem.batch_id) : null,
        item_batch_id: tempItem.batch_id ? String(tempItem.batch_id) : null,
        qty_to_pick: 0,
        item_uom: String(line.gd_order_uom_id || line.good_delivery_uom_id || ""),
        pending_process_qty: 0,
        source_bin: String(tempItem.location_id),
        line_status: "Open",
        so_no: line.line_so_no,
        gd_no: gd.delivery_no,
        so_id: String(line.line_so_id || ""),
        so_line_id: String(line.so_line_item_id || ""),
        gd_id: String(gd.id),
        gd_line_id: String(line.id),
        serial_numbers: [],
        is_serialized_item: 0,
        handling_unit_id: tempItem.handling_unit_id
          ? String(tempItem.handling_unit_id)
          : null,
      });
    }

    const grp = groups.get(groupKey);
    grp.qty_to_pick += parseFloat(tempItem.gd_quantity || 0);
    grp.pending_process_qty += parseFloat(tempItem.gd_quantity || 0);
    if (tempItem.serial_number) {
      grp.serial_numbers.push(String(tempItem.serial_number));
      grp.is_serialized_item = 1;
    }
  }

  let items = [];
  for (const grp of groups.values()) {
    if (grp.serial_numbers.length > 0) {
      grp.serial_numbers = grp.serial_numbers.join(", ");
    } else {
      delete grp.serial_numbers;
    }
    items.push(grp);
  }

  // HU header sort + injection (matches GDconvertToPicking.json behavior)
  items.sort((a, b) => {
    if (a.gd_line_id !== b.gd_line_id) return 0;
    const aHU = a.handling_unit_id || "";
    const bHU = b.handling_unit_id || "";
    if (aHU === bHU) return 0;
    return aHU < bHU ? -1 : 1;
  });

  const withHeaders = [];
  let lastHuId = null;
  for (const row of items) {
    const huId = row.handling_unit_id;
    if (huId && huId !== lastHuId) {
      withHeaders.push({
        row_type: "header",
        handling_unit_id: huId,
        hu_select: 0,
      });
      lastHuId = huId;
    } else if (!huId) {
      lastHuId = null;
    }
    withHeaders.push({ ...row, row_type: "item" });
  }
  return withHeaders;
};

(async () => {
  try {
    const splitMode = await this.getValue("dialog_split_picking.split");
    const tierLevel = await this.getValue("dialog_split_picking.tier_level");

    const stateRaw = await this.getValue("split_state");
    const state = stateRaw ? JSON.parse(stateRaw) : {};
    const gdIds = Array.isArray(state.gd_ids) ? state.gd_ids : [];

    if (gdIds.length === 0) {
      this.$message.error("No goods deliveries selected.");
      return;
    }

    this.showLoading("Computing picking groups...");

    // 1. Re-fetch full GD documents (selectedRecords from list view may not
    //    carry temp_qty_data / picked_temp_qty_data on each line).
    const gdIdsClean = gdIds.map((id) => String(id)).filter(Boolean);
    if (gdIdsClean.length === 0) {
      this.hideLoading();
      this.$message.error("No valid goods delivery IDs.");
      return;
    }
    const gdResult = await db
      .collection("goods_delivery")
      .filter([
        {
          type: "branch",
          operator: "all",
          children: [
            {
              prop: "id",
              operator: "in",
              value: gdIdsClean,
            },
          ],
        },
      ])
      .get();
    const gds = gdResult?.data || [];
    if (gds.length === 0) {
      this.hideLoading();
      this.$message.error("Could not fetch selected goods deliveries.");
      return;
    }

    // 2. Per line, compute remaining tempItems (subtract cumulative picked).
    //    Skip lines where remaining is empty or terminal status.
    const entries = []; // each: { gd, line, tempItem }
    for (const gd of gds) {
      for (const line of gd.table_gd || []) {
        if (!line.material_id) continue;
        if (line.picking_status === "Completed") continue;
        if (line.picking_status === "Cancelled") continue;

        const remaining = subtractPickedFromTemp(line);
        for (const tempItem of remaining) {
          entries.push({ gd, line, tempItem });
        }
      }
    }

    if (entries.length === 0) {
      this.hideLoading();
      this.$message.error("No remaining quantity to pick on the selected GDs.");
      return;
    }

    // 3. Build groups.
    const groups = []; // each: { key, entries }

    if (splitMode === "by_area") {
      const tierNum = String(tierLevel || "").replace(/^tier_/, "");
      if (!tierNum || !["1", "2", "3", "4", "5"].includes(tierNum)) {
        this.hideLoading();
        this.$message.error("Invalid tier level.");
        return;
      }
      const tierCodeField = `bin_code_tier_${tierNum}`;
      const tierActiveField = `tier_${tierNum}_active`;

      const locationIds = [
        ...new Set(
          entries.map((e) => e.tempItem.location_id).filter(Boolean),
        ),
      ];
      const binResult = await db
        .collection("bin_location")
        .filter([
          {
            type: "branch",
            operator: "all",
            children: [
              {
                prop: "id",
                operator: "in",
                value: locationIds.map((id) => String(id)),
              },
            ],
          },
        ])
        .get();
      const binByLoc = {};
      for (const bin of binResult?.data || []) {
        binByLoc[bin.id] = bin;
      }

      const grouped = new Map();
      const skipped = [];
      for (const entry of entries) {
        const bin = binByLoc[entry.tempItem.location_id];
        if (!bin) {
          skipped.push({ entry, reason: "bin not found" });
          continue;
        }
        if (bin[tierActiveField] !== 1) {
          skipped.push({ entry, reason: `${tierActiveField} is not active` });
          continue;
        }
        const tierCode = bin[tierCodeField];
        if (!tierCode) {
          skipped.push({ entry, reason: `${tierCodeField} is empty` });
          continue;
        }
        if (!grouped.has(tierCode)) grouped.set(tierCode, []);
        grouped.get(tierCode).push(entry);
      }

      if (skipped.length > 0) {
        console.warn(
          `Skipped ${skipped.length} item(s) during by_area grouping:`,
          skipped,
        );
      }

      if (grouped.size === 0) {
        this.hideLoading();
        this.$message.error(
          `No items have a valid ${tierCodeField} on an active tier.`,
        );
        return;
      }

      for (const [tierCode, groupEntries] of grouped.entries()) {
        groups.push({ key: tierCode, entries: groupEntries });
      }
    } else {
      // no_split (default)
      groups.push({ key: "All", entries });
    }

    // 4. Build picking-item array per group.
    const groupPayloads = groups.map((g) => {
      const tablePickingItems = buildTablePickingItems(g.entries);

      // Aggregate header fields from contributing GDs.
      const gdsInGroup = [
        ...new Map(g.entries.map((e) => [e.gd.id, e.gd])).values(),
      ];
      const gdNoArr = gdsInGroup.map((gd) => String(gd.id));
      const deliveryNo = gdsInGroup.map((gd) => gd.delivery_no).join(", ");
      const soNos = [
        ...new Set(
          tablePickingItems
            .filter((r) => r.row_type !== "header")
            .map((r) => r.so_no)
            .filter(Boolean),
        ),
      ].join(", ");
      const customerIds = [
        ...new Set(gdsInGroup.map((gd) => gd.customer_name).filter(Boolean)),
      ];
      const refDoc = gdsInGroup[0]?.gd_ref_doc || "";

      return {
        key: g.key,
        gd_ids: gdNoArr,
        delivery_no: deliveryNo,
        so_no: soNos,
        customer_id: customerIds,
        ref_doc: refDoc,
        table_picking_items: tablePickingItems,
      };
    });

    // 5. Persist groups + reset index/assignees, then open dialog_assignee
    //    for the first group.
    state.groups = groupPayloads;
    state.index = 0;
    state.assignees = [];
    await this.setData({
      split_state: JSON.stringify(state),
      "dialog_assignee.area_name": groupPayloads[0].key,
      "dialog_assignee.assignee": [],
    });

    this.hideLoading();
    await this.closeDialog("dialog_split_picking");
    await this.openDialog("dialog_assignee");
  } catch (error) {
    this.hideLoading();
    console.error("SplitPickingConfirm error:", error);
    this.$message.error(error.message || "Failed to compute picking groups.");
  }
})();
