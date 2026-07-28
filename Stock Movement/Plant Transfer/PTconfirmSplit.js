// split_dialog Confirm — replaces the source line with N sibling Split-Parent
// rows. Flat mode only: every resulting row is a real line that the Complete
// path (code_node_PTcompCompute) processes independently.

// Letter suffix for the display line index: A, B, C, ..., Z, AA, AB, ...
const getLetterSuffix = (index) => {
  let suffix = "";
  let num = index;
  while (num >= 0) {
    suffix = String.fromCharCode(65 + (num % 26)) + suffix;
    num = Math.floor(num / 26) - 1;
  }
  return suffix;
};

// Split the line's balance entries across the split rows, FIFO in array order.
// A receiving line normally carries exactly ONE entry, in which case each row
// gets a clone of it carrying that row's share; a legacy multi-entry line has
// its entries consumed in order, and an entry spanning a row boundary is cloned
// into both rows with complementary quantities. Everything except sm_quantity is
// copied verbatim — the snapshot quantities are availability figures, not
// balances to divide.
const sliceTempQtyData = (tempQtyDataStr, splitQtys) => {
  let entries = [];
  try {
    entries = JSON.parse(tempQtyDataStr || "[]");
  } catch (e) {
    entries = [];
  }
  if (!Array.isArray(entries)) {
    entries = [];
  }

  const pool = entries.map((entry) => ({
    entry: entry,
    remaining: parseFloat(entry.sm_quantity) || 0,
  }));
  let poolIndex = 0;

  return splitQtys.map((splitQty) => {
    let needed = parseFloat(splitQty) || 0;
    const slice = [];

    while (needed > 0.0005 && poolIndex < pool.length) {
      const current = pool[poolIndex];
      if (current.remaining <= 0.0005) {
        poolIndex++;
        continue;
      }
      const take = Math.min(current.remaining, needed);
      // Deep clone so no two rows share an entry object.
      const cloned = JSON.parse(JSON.stringify(current.entry));
      cloned.sm_quantity = parseFloat(take.toFixed(3));
      delete cloned.id;
      slice.push(cloned);

      current.remaining = parseFloat((current.remaining - take).toFixed(3));
      needed = parseFloat((needed - take).toFixed(3));
    }

    return JSON.stringify(slice);
  });
};

// Spread-based so fields this handler does not enumerate — handling_unit_id and
// view_hu (neither is a declared column), temp_hu_data, batch_id, issuing_plant,
// receiving_plant, uom_options, balance_id — survive the rebuild.
const buildPtRow = (sourceRow, overrides, options = {}) => {
  const { isNewRow = false } = options;
  const row = Object.assign({}, sourceRow, overrides);

  // Every row loses its DB sub-record id. On save the platform soft-deletes the
  // existing lines and re-inserts the whole table in array order, so an id-less
  // row is what keeps the saved order equal to the on-screen order. Leave an id
  // on the untouched rows and the platform matches those in place and pushes the
  // new split rows to the end instead.
  delete row.id;

  // fm_key is the client-side render key. The spread copied the source row's, so
  // a genuinely new row must drop it; the platform mints a replacement.
  if (isNewRow) {
    delete row.fm_key;
  }

  return row;
};

(async () => {
  try {
    const data = this.getValues();
    const tableSM = data.stock_movement;
    const splitDialogData = data.split_dialog;
    const tableSplit = splitDialogData.table_split || [];
    const rowIndex = splitDialogData.rowIndex;
    const sourceRow = tableSM[rowIndex];

    if (!sourceRow) {
      throw new Error("The line being split no longer exists.");
    }
    if (tableSplit.length < 2) {
      throw new Error("A split needs at least 2 rows.");
    }

    for (const [i, splitItem] of tableSplit.entries()) {
      if (!(parseFloat(splitItem.received_qty) > 0)) {
        throw new Error(`Split row ${i + 1}: quantity must be greater than 0.`);
      }
      if (!splitItem.storage_location_id || !splitItem.location_id) {
        throw new Error(
          `Split row ${i + 1}: storage location and bin are required.`,
        );
      }
    }

    // Exact sum, not a tolerance ceiling. Under-splitting would silently drop
    // quantity: the leftover child that carries an unreceived remainder is built
    // per line, so anything not present on a line is never re-offered and its
    // In Transit stock is stranded with no document able to consume it.
    const totalSplitQty = parseFloat(
      tableSplit
        .reduce((sum, item) => sum + (parseFloat(item.received_qty) || 0), 0)
        .toFixed(3),
    );
    const totalQuantity = parseFloat(
      (parseFloat(sourceRow.total_quantity) || 0).toFixed(3),
    );

    if (Math.abs(totalSplitQty - totalQuantity) > 0.0005) {
      throw new Error(
        `Split quantities (${totalSplitQty}) must equal the line's total quantity (${totalQuantity}) exactly.`,
      );
    }

    const tempSlices = sliceTempQtyData(
      sourceRow.temp_qty_data,
      tableSplit.map((item) => item.received_qty),
    );

    // Cosmetic only — the save workflow re-stamps line_index = arrayIndex + 1
    // before anything reads it.
    const baseLineIndex = parseInt(sourceRow.line_index, 10) || rowIndex + 1;
    const unitPrice = parseFloat(sourceRow.unit_price) || 0;

    const latestTableSM = [];

    for (const [index, smItem] of tableSM.entries()) {
      if (index !== rowIndex) {
        latestTableSM.push(buildPtRow(smItem, {}));
        continue;
      }

      for (const [splitIndex, splitItem] of tableSplit.entries()) {
        const qty = parseFloat(splitItem.received_qty) || 0;
        latestTableSM.push(
          buildPtRow(
            smItem,
            {
              line_index: `${baseLineIndex}-${getLetterSuffix(splitIndex)}`,
              total_quantity: qty,
              // Seeded to the full share; the receiver can still lower it to
              // receive this row partially, which spawns a leftover child.
              received_quantity: qty,
              amount: parseFloat((qty * unitPrice).toFixed(4)),
              storage_location_id: splitItem.storage_location_id,
              location_id: splitItem.location_id,
              temp_qty_data: tempSlices[splitIndex],
              is_split: "Yes",
              parent_or_child: "Split-Parent",
              parent_index: index,
              split_source_index: index,
            },
            // The first row succeeds the source row; the rest are new.
            { isNewRow: splitIndex !== 0 },
          ),
        );
      }
    }

    await this.setData({ stock_movement: latestTableSM });

    // Every row's per-index state has to be re-asserted: the whole table was
    // replaced, so indices below the split point have shifted and the new rows
    // have never been through the mount-time passes.
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
      // Handling units are whole-only, so their quantity stays locked.
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

      // Batch number is editable only while blank (mirrors the mount-time rule);
      // "-" is non-batch and "Auto-generated batch number" is filled on save.
      this.disabled(
        [`stock_movement.${index}.batch_no`],
        !(smItem.batch_no === "" || !smItem.batch_no),
      );

      await this.setOptionData(
        [`stock_movement.${index}.category`],
        filteredCategories,
      );
      // Blocked stock stays Blocked on arrival.
      this.disabled(
        [`stock_movement.${index}.category`],
        smItem.category === "Blocked",
      );
    }

    await this.closeDialog("split_dialog");

    this.setData({
      [`split_dialog.item_id`]: "",
      [`split_dialog.item_name`]: "",
      [`split_dialog.to_received_qty`]: 0,
      [`split_dialog.rowIndex`]: 0,
      [`split_dialog.no_of_split`]: 0,
      [`split_dialog.table_split`]: [],
    });
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || String(error));
  }
})();
