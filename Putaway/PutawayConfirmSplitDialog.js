// q8 kills float residue in the split total (30 x 17.656 = 529.6800000000001); EPS keeps 3dp leniency, as the GR split
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const EPS = 0.0005;

const setPutawayItemData = (
  itemData,
  lineIndex,
  qtyToPutaway,
  storageLocation,
  targetBin,
  remark,
  isSplit,
  parentOrChild,
  index,
  selectSerialNumber = [],
) => {
  // A default parameter only applies to `undefined`, not `null` -- and the form
  // stores select_serial_number as null on non-serialised lines, so it arrives
  // here as null and slips straight past the default.
  const serialNumbers = Array.isArray(selectSerialNumber)
    ? selectSerialNumber
    : [];

  return {
    line_index: lineIndex,
    item_code: itemData.item_code,
    item_name: itemData.item_name,
    item_desc: itemData.item_desc,
    batch_no: itemData.batch_no,
    serial_numbers: JSON.stringify(serialNumbers.join("\n")),
    select_serial_number: serialNumbers,
    source_inv_category: itemData.source_inv_category,
    target_inv_category: itemData.target_inv_category,
    received_qty: parentOrChild === "Parent" ? itemData.received_qty : 0,
    item_uom: itemData.item_uom,
    source_bin: itemData.source_bin,
    qty_to_putaway: qtyToPutaway,
    pending_process_qty:
      parentOrChild === "Parent" ? itemData.pending_process_qty : qtyToPutaway,
    putaway_qty:
      isSplit === "No" && parentOrChild === "Parent"
        ? itemData.putaway_qty
        : qtyToPutaway,
    storage_location: storageLocation,
    target_location: targetBin,
    remark: remark,
    line_status: itemData.line_status,
    is_split: isSplit,
    parent_or_child: parentOrChild,
    po_no: itemData.po_no,
    parent_index: index,
    unit_price: itemData.unit_price,
    total_price: itemData.total_price,
    qi_no: itemData.qi_no,
    is_serialized_item: itemData.is_serialized_item,
    gr_line_id: itemData.gr_line_id || "",
    // A handling unit is one physical pallet and cannot land in two bins, so the
    // children of a split never inherit it -- only untouched and parent rows keep
    // it. Without this, an HU line elsewhere in the document loses hu_data, its
    // handling unit is never relocated, and its stock is added as loose.
    hu_data: parentOrChild === "Child" ? "" : itemData.hu_data || "",
    handling_unit_id:
      parentOrChild === "Child" ? "" : itemData.handling_unit_id || "",
  };
};

const SPLIT_PARENT_LOCKED = [
  "line_index",
  "item_code",
  "item_name",
  "item_desc",
  "batch_no",
  "select_serial_number",
  "source_inv_category",
  "target_inv_category",
  "received_qty",
  "item_uom",
  "source_bin",
  "qty_to_putaway",
  "pending_process_qty",
  "putaway_qty",
  "storage_location",
  "target_location",
  "remark",
];

(async () => {
  try {
    const data = this.getValues();
    const tablePutawayItem = data.table_putaway_item;
    const splitDialogData = data.split_dialog;
    const tableSplit = splitDialogData.table_split;

    const totalStoreInQty = q8(
      tableSplit
        .reduce((sum, item) => sum + (parseFloat(item.store_in_qty) || 0), 0),
    );

    if (Math.abs(totalStoreInQty - q8(splitDialogData.qty_to_putaway)) > EPS) {
      throw new Error(
        "Total store in quantity must be equal to pending putaway quantity.",
      );
    }

    const rowIndex = splitDialogData.rowIndex;

    const latestPutawaytItem = [];

    // rows keep their own fields (id, fm_key, bundle items); split rows name their line in parent_line_id
    for (const [index, paItem] of tablePutawayItem.entries()) {
      if (index === rowIndex) {
        latestPutawaytItem.push({
          ...paItem,
          ...setPutawayItemData(
            paItem,
            paItem.parent_index + 1,
            totalStoreInQty,
            "",
            "",
            paItem.remark,
            "Yes",
            "Parent",
            index,
            paItem.select_serial_number,
          ),
        });

        for (const [dialogLineIndex, dialogItem] of tableSplit.entries()) {
          const childItem = setPutawayItemData(
            paItem,
            `${paItem.parent_index + 1} - ${dialogLineIndex + 1}`,
            dialogItem.store_in_qty,
            dialogItem.storage_location,
            dialogItem.target_bin,
            dialogItem.remark,
            "No",
            "Child",
            index,
            dialogItem.select_serial_number,
          );
          if (paItem.id) childItem.parent_line_id = paItem.id;
          latestPutawaytItem.push(childItem);
        }
      } else {
        latestPutawaytItem.push({
          ...paItem,
          ...setPutawayItemData(
            paItem,
            paItem.line_index,
            paItem.qty_to_putaway,
            paItem.storage_location,
            paItem.target_location,
            paItem.remark,
            paItem.is_split,
            paItem.parent_or_child,
            paItem.parent_index,
            paItem.select_serial_number,
          ),
        });
      }
    }

    console.log("latestPutawayItem", latestPutawaytItem.length);
    await this.setData({ table_putaway_item: latestPutawaytItem });

    // rows keep their fm_key and so their states: only split parents, split rows and serial rows are set again
    const lock = [];
    const unlock = [];
    const parentLocations = {};

    for (const [index, paItem] of latestPutawaytItem.entries()) {
      const path = `table_putaway_item.${index}`;
      if (paItem.is_split === "Yes" && paItem.parent_or_child === "Parent") {
        SPLIT_PARENT_LOCKED.forEach((column) => lock.push(`${path}.${column}`));
        parentLocations[`${path}.storage_location`] = "";
        parentLocations[`${path}.target_location`] = "";
      } else if (paItem.parent_or_child === "Child") {
        lock.push(`${path}.button_split`);
        if (paItem.is_serialized_item === 1) {
          lock.push(`${path}.select_serial_number`, `${path}.putaway_qty`);
        }
      } else if (paItem.is_serialized_item === 1) {
        unlock.push(`${path}.select_serial_number`, `${path}.putaway_qty`);
      }
    }

    if (lock.length > 0) this.disabled(lock, true);
    if (unlock.length > 0) this.disabled(unlock, false);
    if (Object.keys(parentLocations).length > 0) this.setData(parentLocations);

    await this.closeDialog("split_dialog");
    await this.triggerEvent("func_reset_split_dialog");
  } catch (error) {
    this.$message.error(error.message || String(error));
  }
})();
