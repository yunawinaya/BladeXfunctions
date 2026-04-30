// Pick to Parent HU — nests a source HU (from table_hu_source) inside the
// currently-selected target HU in table_hu as a "nested_hu" entry in temp_data.
// Source HU keeps its own identity and items; on save the source HU's
// parent_hu_id will be set to the target HU's id.
//
// Paste into a new handler slot (e.g. "PackingPickToParentHU") and wire to
// the "Pick to Parent HU" row action on table_hu_source (line 5300).

(async () => {
  try {
    const sourceHeader = arguments[0] && arguments[0].row;
    if (!sourceHeader) {
      this.$message.warning("Source row not found.");
      return;
    }
    if (sourceHeader.row_type !== "header") {
      this.$message.warning(
        "Please click Pick to Parent HU on an HU header row.",
      );
      return;
    }
    if (sourceHeader.hu_status === "Picked") {
      this.$message.warning("This HU has already been picked.");
      return;
    }
    if (sourceHeader.hu_status === "Pending") {
      this.$message.warning(
        "This HU hasn't been picked from upstream yet. Wait for the corresponding Picking to complete.",
      );
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

    const tableHu = data.table_hu || [];
    const targetHu = tableHu[selectedHuIndex];
    if (!targetHu) {
      this.$message.warning("Selected target HU no longer exists.");
      return;
    }
    if (targetHu.hu_row_type === "locked") {
      this.$message.warning(
        "Cannot nest an HU inside a locked HU. Select a generated HU instead.",
      );
      return;
    }

    const sourceHuId = sourceHeader.handling_unit_id;
    if (!sourceHuId) {
      this.$message.warning(
        "Source HU is missing handling_unit_id; cannot nest.",
      );
      return;
    }
    if (targetHu.handling_unit_id === sourceHuId) {
      this.$message.warning("Cannot nest an HU inside itself.");
      return;
    }

    // Fetch source HU master for identity fields — table_hu_source headers
    // don't carry handling_no / hu_material_id / weights.
    const huRes = await db
      .collection("handling_unit")
      .where({ id: sourceHuId })
      .get();
    const huMaster = (huRes && huRes.data && huRes.data[0]) || {};

    // Snapshot children from table_hu_source (items that were picked as part of
    // this source HU in the upstream Picking)
    const huSource = data.table_hu_source || [];
    const childRows = huSource.filter(
      (r) => r.row_type === "item" && r.handling_unit_id === sourceHuId,
    );
    const children = childRows.map((c, i) => ({
      line_index: i,
      line_item_id: c.id,
      // Form schema for table_hu_source doesn't declare item_id, so it gets
      // stripped on load. Use item_code (which IS in the schema) — matches
      // what PackingPickItemToHU does for the same reason.
      item_id: c.item_code,
      item_code: c.item_code,
      item_name: c.item_name,
      item_desc: c.item_desc,
      item_uom: c.item_uom,
      batch_no: c.batch_no,
      bin_location: c.bin_location,
      total_quantity: Number(c.total_quantity) || 0,
      so_id: c.so_id,
      so_no: c.so_no,
      so_line_id: c.so_line_id,
      gd_id: c.gd_id,
      gd_no: c.gd_no,
      gd_line_id: c.gd_line_id,
      to_id: c.to_id,
      to_line_id: c.to_line_id,
    }));

    const nestedTotal = children.reduce(
      (s, c) => s + (Number(c.total_quantity) || 0),
      0,
    );
    const nestedItemCount = new Set(
      children.map((c) => c.item_id).filter(Boolean),
    ).size;

    // Append nested_hu entry to target's temp_data
    const existing = JSON.parse(targetHu.temp_data || "[]");
    existing.push({
      type: "nested_hu",
      line_index: existing.length,
      nested_hu_id: sourceHuId,
      handling_no: huMaster.handling_no || "",
      hu_material_id: huMaster.hu_material_id || "",
      hu_type: huMaster.hu_type || "",
      hu_uom: huMaster.hu_uom || "",
      children,
      item_count: nestedItemCount,
      total_quantity: nestedTotal,
    });

    // Aggregate rollup across direct items + nested children
    const allItemIds = new Set();
    let totalQty = 0;
    for (const e of existing) {
      if (e.type === "nested_hu") {
        for (const c of e.children || []) {
          if (c.item_id) allItemIds.add(c.item_id);
          totalQty += Number(c.total_quantity) || 0;
        }
      } else {
        if (e.item_id) allItemIds.add(e.item_id);
        totalQty += Number(e.total_quantity) || 0;
      }
    }

    // Flip hu_status to Picked on source HU's header + item rows
    const newHuSource = huSource.map((r) =>
      r.handling_unit_id === sourceHuId &&
      (r.row_type === "header" || r.row_type === "item")
        ? { ...r, hu_status: "Picked" }
        : r,
    );

    await this.setData({
      [`table_hu.${selectedHuIndex}.temp_data`]: JSON.stringify(existing),
      [`table_hu.${selectedHuIndex}.item_count`]: allItemIds.size,
      [`table_hu.${selectedHuIndex}.total_quantity`]: totalQty,
      [`table_hu.${selectedHuIndex}.hu_status`]: "Packed",
      table_hu_source: newHuSource,
    });

    this.$message.success(
      `HU ${huMaster.handling_no || sourceHuId} nested inside ${targetHu.handling_no || selectedHuIndex + 1}.`,
    );
  } catch (error) {
    console.error("PackingPickToParentHU error:", error);
    this.$message.error(error.message || String(error));
  }
})();
