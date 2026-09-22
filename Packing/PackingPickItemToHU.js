// Flow A: Pick to HU from table_item_source.
// Paste into the `onTableItemSourcefunc` handler slot (key wj4ch5p1).
//
// Preconditions (soft — toast + no-op if violated):
//   1. Exactly one target HU row in table_hu must be selected
//      (selected_hu_index >= 0).
//   2. The selected target must be hu_row_type === "generated".
//   3. Source row's qty_to_pick must be > 0 and <= remaining_qty.
//
// Effect:
//   - Append one entry to the selected target HU's temp_data.
//   - Recompute target HU's item_count / total_quantity.
//   - Trigger PackingRecomputeSource to update all source rows.

(async () => {
  try {
    const sourceRow = arguments[0] && arguments[0].row;
    if (!sourceRow) {
      this.$message.warning("Source row not found.");
      return;
    }
    const data = this.getValues();

    const selectedHuIndex = Number(data.selected_hu_index);
    if (!Number.isFinite(selectedHuIndex) || selectedHuIndex < 0) {
      this.$message.warning(
        "Please select a target HU in the packing table first.",
      );
      return;
    }

    const targetHu = (data.table_hu || [])[selectedHuIndex];
    if (!targetHu) {
      this.$message.warning("Selected target HU no longer exists.");
      return;
    }
    if (targetHu.hu_row_type === "locked") {
      this.$message.warning(
        "Cannot add items to a locked HU. Select a generated HU instead.",
      );
      return;
    }
    if (targetHu.hu_status === "Completed") {
      this.$message.warning(
        "This HU is already completed and cannot receive more items.",
      );
      return;
    }

    if (!sourceRow.id) {
      this.$message.error(
        "Source row is missing a stable `id`. The data loader must assign one — picked entries can't be attributed back to the source without it.",
      );
      return;
    }

    // Picked-qty per source row, read back from the GD. PackingRecomputeSource
    // overwrites a row's own picked_qty with how much has been PACKED, so the row
    // itself no longer says whether the warehouse ever picked the goods.
    // Keyed like gudzrvMQ's srcKey: gd_line_id | bin_location | batch_no.
    const srcKey = (lineId, bin, batch) =>
      String(lineId == null ? "" : lineId) +
      "|" +
      String(bin == null ? "" : bin) +
      "|" +
      String(batch == null ? "" : batch);

    // gd_id is varchar, but legacy rows hold a STRINGIFIED array ('["123"]') and
    // some callers hand over a real array -- gudzrvMQ normalises the same way on
    // create. Passing either straight to .doc() throws.
    const firstId = (v) => {
      if (Array.isArray(v)) return v.filter(Boolean)[0] || "";
      if (typeof v === "string" && v.charAt(0) === "[") {
        try {
          const a = JSON.parse(v);
          return Array.isArray(a) ? a.filter(Boolean)[0] || "" : v;
        } catch (e) {
          return v;
        }
      }
      return v || "";
    };

    const pickedMap = {};
    // Stays false when there is no GD (a Sales-Order-based packing has none) or
    // the read fails, and the guard below is then SKIPPED rather than blocking:
    // an empty map would read as "nothing picked" and refuse everything.
    let pickedCheckReady = false;
    const gdId = firstId(data.gd_id);
    if (gdId) {
      try {
      const gdRes = await db.collection("goods_delivery").doc(gdId).get();
      const gd = gdRes?.data?.[0];
      // table_gd is a tree: an item bundle is one parent row with its real lines
      // under `children`.
      const gdLines = (
        gd && Array.isArray(gd.table_gd) ? gd.table_gd : []
      ).flatMap((row) => [
        row,
        ...(Array.isArray(row.children) ? row.children : []),
      ]);
      const parseJsonSafe = (s) => {
        try {
          return s ? JSON.parse(s) : [];
        } catch (e) {
          return [];
        }
      };
      for (const line of gdLines) {
        if (!line.material_id) continue;
        const picked = parseJsonSafe(line.picked_temp_qty_data);
        // picked_temp_qty_data is only written when allow_full_picking is on. In
        // the single-Picking flow a line is either fully picked or not picked at
        // all, and picking_status is what says which.
        const entries =
          Array.isArray(picked) && picked.length > 0
            ? picked
            : line.picking_status === "Completed"
              ? parseJsonSafe(line.temp_qty_data)
              : [];
        for (const e of entries) {
          // HU-bound allocations live in table_hu_source, which is gated
          // separately on hu_status.
          if (e.handling_unit_id) continue;
          const k = srcKey(line.id, e.location_id, e.batch_id);
          pickedMap[k] = (pickedMap[k] || 0) + (Number(e.gd_quantity) || 0);
        }
      }
      pickedCheckReady = true;
      } catch (e) {
        // Fail OPEN. A flaky read must not strand a packer on a legitimately
        // picked order, and this runs on every pick tap. onSave_Completed
        // re-reads the GD and still refuses to complete while any line is
        // unpicked, so an item slipped in here cannot ship.
        console.error("Picked-qty check unavailable:", e);
        this.$message.warning(
          "Pick check skipped \u2014 could not read the Goods Delivery.",
        );
      }
    }

    // picked_qty is what PackingRecomputeSource just wrote: already packed.
    const packableOf = (row) =>
      Math.max(
        0,
        (pickedMap[srcKey(row.gd_line_id, row.bin_location, row.batch_no)] || 0) -
          (Number(row.picked_qty) || 0),
      );

    const qtyToPick = Number(sourceRow.qty_to_pick) || 0;
    const remaining = Number(sourceRow.remaining_qty) || 0;
    if (qtyToPick <= 0) {
      this.$message.warning("Quantity to pick must be greater than zero.");
      return;
    }
    if (qtyToPick > remaining) {
      this.$message.warning(
        `Quantity (${qtyToPick}) exceeds remaining (${remaining}).`,
      );
      return;
    }
    const packable = packableOf(sourceRow);
    if (pickedCheckReady && qtyToPick > packable) {
      this.$message.warning(
        packable <= 0
          ? "This item hasn't been picked from upstream yet. Wait for the corresponding Picking to complete."
          : `Quantity (${qtyToPick}) exceeds the picked quantity still available (${packable}).`,
      );
      return;
    }

    const existing = JSON.parse(targetHu.temp_data || "[]");

    // Merge with existing entry if the same source row was already picked into
    // this HU — avoids duplicate lines in temp_data for the same item/batch/bin.
    const existingIdx = existing.findIndex(
      (e) => e.line_item_id === sourceRow.id,
    );
    if (existingIdx >= 0) {
      existing[existingIdx].total_quantity =
        (Number(existing[existingIdx].total_quantity) || 0) + qtyToPick;
    } else {
      existing.push({
        line_index: existing.length,
        line_item_id: sourceRow.id,
        balance_id: sourceRow.balance_id,
        item_id: sourceRow.item_code,
        item_code: sourceRow.item_code,
        item_name: sourceRow.item_name,
        item_desc: sourceRow.item_desc,
        remark: sourceRow.remark,
        remark_2: sourceRow.remark_2,
        remark_3: sourceRow.remark_3,
        item_uom: sourceRow.item_uom,
        batch_no: sourceRow.batch_no,
        bin_location: sourceRow.bin_location,
        total_quantity: qtyToPick,
        so_id: sourceRow.so_id,
        so_no: sourceRow.so_no,
        so_line_id: sourceRow.so_line_id,
        gd_id: sourceRow.gd_id,
        gd_no: sourceRow.gd_no,
        gd_line_id: sourceRow.gd_line_id,
        to_id: sourceRow.to_id,
        to_no: sourceRow.to_no,
        to_line_id: sourceRow.to_line_id,
      });
    }

    // Aggregate rollup across direct items + nested_hu children
    const distinctItemIds = new Set();
    let totalQty = 0;
    for (const e of existing) {
      if (e.type === "nested_hu") {
        for (const c of e.children || []) {
          if (c.item_id) distinctItemIds.add(c.item_id);
          totalQty += Number(c.total_quantity) || 0;
        }
      } else {
        if (e.item_id) distinctItemIds.add(e.item_id);
        totalQty += Number(e.total_quantity) || 0;
      }
    }


    // Seed the HU's remarks from the first packed item carrying one. A value
    // already on the row -- typed or seeded -- is never overwritten.
    const huRemarks = {};
    for (const f of ["remark", "remark_2", "remark_3"]) {
      if (targetHu[f]) continue;
      let v = "";
      for (const e of existing) {
        for (const r of e.type === "nested_hu" ? e.children || [] : [e]) {
          if (r[f]) {
            v = r[f];
            break;
          }
        }
        if (v) break;
      }
      if (v) huRemarks[`table_hu.${selectedHuIndex}.${f}`] = v;
    }

    await this.setData({
      ...huRemarks,
      [`table_hu.${selectedHuIndex}.temp_data`]: JSON.stringify(existing),
      [`table_hu.${selectedHuIndex}.item_count`]: distinctItemIds.size,
      [`table_hu.${selectedHuIndex}.total_quantity`]: totalQty,
      [`table_hu.${selectedHuIndex}.hu_status`]: "Packed",
    });

    await this.triggerEvent("PackingRecomputeSource");

    this.$message.success(
      `Picked ${qtyToPick} ${sourceRow.item_name || ""} to HU ${targetHu.handling_no || selectedHuIndex + 1}.`,
    );
  } catch (error) {
    console.error("PackingPickItemToHU error:", error);
    this.$message.error(error.message || String(error));
  }
})();
