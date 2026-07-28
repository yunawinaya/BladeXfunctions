// confirm_split_dialog Confirm — "entering the edit mode will clear the split
// information". Collapses the clicked row's sibling Split-Parent rows back into
// one regular row, then reopens split_dialog against it so the user can re-split.

// Sibling grouping key. split_source_index is not a declared subform column, so
// on a reloaded document it may be absent; parent_index is declared and is the
// fallback. A row with neither is NEVER collapsed — workflow-built rows can
// share a defaulted parent_index, and grouping on that would merge unrelated
// lines.
const keyOfRow = (row) => {
  if (row.split_source_index !== undefined && row.split_source_index !== null) {
    return `s:${row.split_source_index}`;
  }
  if (row.parent_index !== undefined && row.parent_index !== null) {
    return `p:${row.parent_index}`;
  }
  return null;
};

// Two entries describe the same physical stock when every identifying field
// matches; only then may their quantities be added back together. Slices made by
// PTconfirmSplit always match, so a split followed by a collapse round-trips to
// the original entry set.
const identityOf = (entry) =>
  [
    entry.balance_id || "",
    entry.batch_id || "",
    entry.handling_unit_id || "",
    entry.category || entry.category_from || "",
    entry.location_id || "",
    entry.serial_number || "",
  ].join("|");

const mergeTempQtyData = (rows) => {
  const merged = new Map();

  for (const row of rows) {
    let entries = [];
    try {
      entries = JSON.parse(row.temp_qty_data || "[]");
    } catch (e) {
      entries = [];
    }
    if (!Array.isArray(entries)) {
      continue;
    }

    for (const entry of entries) {
      const key = identityOf(entry);
      if (merged.has(key)) {
        const target = merged.get(key);
        target.sm_quantity = parseFloat(
          (
            (parseFloat(target.sm_quantity) || 0) +
            (parseFloat(entry.sm_quantity) || 0)
          ).toFixed(3),
        );
      } else {
        const cloned = JSON.parse(JSON.stringify(entry));
        cloned.sm_quantity = parseFloat(cloned.sm_quantity) || 0;
        delete cloned.id;
        merged.set(key, cloned);
      }
    }
  }

  return Array.from(merged.values());
};

(async () => {
  try {
    const rowIndex = this.getValue("confirm_split_dialog.rowIndex");
    const tableSM = this.getValues().stock_movement;
    const currentRow = tableSM[rowIndex];

    if (!currentRow) {
      throw new Error("The line being re-split no longer exists.");
    }

    const groupKey = keyOfRow(currentRow);
    if (groupKey === null) {
      throw new Error(
        "This split cannot be edited because its grouping information is missing.",
      );
    }

    const isSibling = (row) =>
      row.is_split === "Yes" &&
      row.parent_or_child === "Split-Parent" &&
      keyOfRow(row) === groupKey;

    const siblings = tableSM.filter(isSibling);
    if (siblings.length === 0) {
      throw new Error("No split rows found for this line.");
    }

    await this.openDialog("split_dialog");
    await this.closeDialog("confirm_split_dialog");

    const sumOf = (selector) =>
      parseFloat(
        siblings
          .reduce((sum, row) => sum + (parseFloat(selector(row)) || 0), 0)
          .toFixed(3),
      );

    const totalQty = sumOf((row) => row.total_quantity);
    const totalReceived = sumOf((row) => row.received_quantity);
    const first = siblings[0];

    const restoredRow = Object.assign({}, first, {
      total_quantity: totalQty,
      received_quantity: totalReceived,
      amount: parseFloat(
        (totalReceived * (parseFloat(first.unit_price) || 0)).toFixed(4),
      ),
      temp_qty_data: JSON.stringify(mergeTempQtyData(siblings)),
      is_split: "No",
      // "Parent" is the column's default for a regular row; only the pair
      // is_split === "Yes" && parent_or_child === "Parent" means a summary row,
      // and this row is no longer split.
      parent_or_child: "Parent",
      parent_index: null,
      split_source_index: null,
    });
    delete restoredRow.id;

    // Replace the first sibling in place with the restored row and drop the
    // rest, so the row keeps its position in the document.
    const latestTableSM = [];
    let newRowIndex = -1;

    for (const row of tableSM) {
      if (isSibling(row)) {
        if (newRowIndex === -1) {
          newRowIndex = latestTableSM.length;
          latestTableSM.push(restoredRow);
        }
      } else {
        latestTableSM.push(Object.assign({}, row));
      }
    }

    latestTableSM[newRowIndex].parent_index = newRowIndex;

    await this.setData({ stock_movement: latestTableSM });

    // Indices below the collapse point have shifted, so re-assert every row's
    // per-index state (same pass as PTconfirmSplit).
    const categoryRes = await db
      .collection("blade_dict")
      .where({ code: "inventory_category" })
      .get();
    const allowedCategories = ["Unrestricted", "Quality Inspection", "Blocked"];
    const filteredCategories = (categoryRes.data || []).filter((category) =>
      allowedCategories.includes(category.dict_key),
    );

    const updatedTableSM = this.getValue("stock_movement");

    for (const [index, smItem] of updatedTableSM.entries()) {
      this.disabled(
        [`stock_movement.${index}.received_quantity`],
        !!smItem.handling_unit_id,
      );
      this.disabled(
        [
          `stock_movement.${index}.storage_location_id`,
          `stock_movement.${index}.location_id`,
        ],
        false,
      );
      this.disabled(
        [`stock_movement.${index}.batch_no`],
        !(smItem.batch_no === "" || !smItem.batch_no),
      );
      await this.setOptionData(
        [`stock_movement.${index}.category`],
        filteredCategories,
      );
      this.disabled(
        [`stock_movement.${index}.category`],
        smItem.category === "Blocked",
      );
    }

    // Re-seed the split dialog against the restored row. This path opens the
    // dialog without going through PTtableSplit, so it repeats the same runtime
    // hides.
    const targetRow = latestTableSM[newRowIndex];

    await this.setData({
      [`split_dialog.item_id`]: targetRow.item_selection,
      [`split_dialog.item_name`]: targetRow.item_name,
      [`split_dialog.to_received_qty`]: totalQty,
      [`split_dialog.rowIndex`]: newRowIndex,
      [`split_dialog.is_parent_split`]: 0,
      [`split_dialog.no_of_split`]: 0,
      [`split_dialog.table_split`]: [],
    });

    this.hide([
      "split_dialog.is_parent_split",
      "split_dialog.import_data",
      "split_dialog.is_batch_item",
      "split_dialog.table_split.select_serial_number",
      "split_dialog.table_split.line_remark_1",
      "split_dialog.table_split.line_remark_2",
      "split_dialog.table_split.line_remark_3",
    ]);
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || String(error));
  }
})();
