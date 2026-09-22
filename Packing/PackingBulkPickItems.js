// Bulk Pick to HU from table_item_source.
// Processes all rows with select_item === 1, picking each row's qty_to_pick
// into the currently-selected target HU's temp_data.
// Paste into a new handler slot (e.g. "PackingBulkPickItems") and wire to a
// toolbar button "Pick Selected to HU" above or near table_item_source.

(async () => {
  try {
    const data = this.getValues();
    const itemSource = data.table_item_source || [];
    const selected = itemSource.filter(
      (r) => r.select_item === 1 || r.select_item === true,
    );

    if (selected.length === 0) {
      this.$message.warning("No items selected.");
      return;
    }

    const selectedHuIndex = Number(data.selected_hu_index);
    if (!Number.isFinite(selectedHuIndex) || selectedHuIndex < 0) {
      this.$message.warning(
        "Please select a target HU in the packing table first.",
      );
      return;
    }

    const tableHu = data.table_hu || [];
    const targetHu = tableHu[selectedHuIndex];
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

    const existing = JSON.parse(targetHu.temp_data || "[]");
    const pickedIds = new Set();
    const skipped = [];

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

    const pickedMap = {};
    if (data.gd_id) {
      const gdRes = await db.collection("goods_delivery").doc(data.gd_id).get();
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
    }

    // picked_qty is what PackingRecomputeSource just wrote: already packed.
    const packableOf = (row) =>
      Math.max(
        0,
        (pickedMap[srcKey(row.gd_line_id, row.bin_location, row.batch_no)] || 0) -
          (Number(row.picked_qty) || 0),
      );

    for (const sourceRow of selected) {
      if (!sourceRow.id) {
        skipped.push({ code: sourceRow.item_code, reason: "no id" });
        continue;
      }
      const qtyToPick = Number(sourceRow.qty_to_pick) || 0;
      const remaining = Number(sourceRow.remaining_qty) || 0;
      if (qtyToPick <= 0) {
        skipped.push({ code: sourceRow.item_code, reason: "qty 0" });
        continue;
      }
      if (qtyToPick > remaining) {
        skipped.push({
          code: sourceRow.item_code,
          reason: `qty ${qtyToPick} > remaining ${remaining}`,
        });
        continue;
      }
      const packable = packableOf(sourceRow);
      if (qtyToPick > packable) {
        skipped.push({
          code: sourceRow.item_code,
          reason:
            packable <= 0
              ? "not picked yet"
              : `qty ${qtyToPick} > picked available ${packable}`,
        });
        continue;
      }

      // Merge with existing entry for same source row — dedupe across picks
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
          to_line_id: sourceRow.to_line_id,
        });
      }
      pickedIds.add(sourceRow.id);
    }

    if (pickedIds.size === 0) {
      this.$message.warning(`No valid rows picked (${skipped.length} skipped).`);
      return;
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

    const newItemSource = itemSource.map((r) =>
      pickedIds.has(r.id) ? { ...r, select_item: 0 } : r,
    );


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
      table_item_source: newItemSource,
    });

    await this.triggerEvent("PackingRecomputeSource");

    const msg =
      skipped.length > 0
        ? `Picked ${pickedIds.size}, skipped ${skipped.length}.`
        : `Picked ${pickedIds.size} item(s) to HU ${targetHu.handling_no || selectedHuIndex + 1}.`;
    this.$message.success(msg);
  } catch (error) {
    console.error("PackingBulkPickItems error:", error);
    this.$message.error(error.message || String(error));
  }
})();
