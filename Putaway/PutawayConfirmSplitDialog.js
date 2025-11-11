const setPutawayItemData = async (
  itemData,
  lineIndex,
  qtyToPutaway,
  storageLocation,
  targetBin,
  remark,
  isSplit,
  parentOrChild,
  index,
  selectSerialNumber = []
) => {
  return {
    line_index: lineIndex,
    item_code: itemData.item_code,
    item_name: itemData.item_name,
    item_desc: itemData.item_desc,
    batch_no: itemData.batch_no,
    serial_numbers: selectSerialNumber,
    select_serial_number: selectSerialNumber,
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
  };
};

(async () => {
  try {
    const data = this.getValues();
    const tablePutawayItem = data.table_putaway_item;
    const splitDialogData = data.split_dialog;
    const tableSplit = splitDialogData.table_split;

    const totalStoreInQty = parseFloat(
      tableSplit
        .reduce((sum, item) => sum + (parseFloat(item.store_in_qty) || 0), 0)
        .toFixed(3)
    );

    if (totalStoreInQty !== splitDialogData.qty_to_putaway) {
      throw new Error(
        "Total store in quantity must be equal to pending putaway quantity."
      );
    }

    const rowIndex = splitDialogData.rowIndex;

    const latestPutawaytItem = [];

    for (const [index, paItem] of tablePutawayItem.entries()) {
      if (index === rowIndex) {
        const parentItem = await setPutawayItemData(
          paItem,
          paItem.parent_index + 1,
          totalStoreInQty,
          "",
          paItem.remark,
          "Yes",
          "Parent",
          index,
          paItem.select_serial_number
        );
        latestPutawaytItem.push(parentItem);

        for (const [dialogLineIndex, dialogItem] of tableSplit.entries()) {
          const childItem = await setPutawayItemData(
            paItem,
            `${paItem.parent_index + 1} - ${dialogLineIndex + 1}`,
            dialogItem.store_in_qty,
            dialogItem.storage_location,
            dialogItem.target_bin,
            dialogItem.remark,
            "No",
            "Child",
            index,
            dialogItem.select_serial_number
          );
          latestPutawaytItem.push(childItem);
        }
      } else {
        const parentItem = await setPutawayItemData(
          paItem,
          paItem.line_index,
          paItem.qty_to_putaway,
          paItem.storage_location,
          paItem.target_location,
          paItem.remark,
          paItem.is_split,
          paItem.parent_or_child,
          paItem.parent_index,
          paItem.select_serial_number
        );
        latestPutawaytItem.push(parentItem);
      }
    }

    console.log("latestPutawayItem", latestPutawaytItem);
    await this.setData({ table_putaway_item: latestPutawaytItem });

    const tablePutaway = this.getValue("table_putaway_item");

    for (const [index, paItem] of tablePutaway.entries()) {
      if (paItem.is_split === "Yes" && paItem.parent_or_child === "Parent") {
        this.disabled(
          [
            `table_putaway_item.${index}.line_index`,
            `table_putaway_item.${index}.item_code`,
            `table_putaway_item.${index}.item_name`,
            `table_putaway_item.${index}.item_desc`,
            `table_putaway_item.${index}.batch_no`,
            `table_putaway_item.${index}.select_serial_number`,
            `table_putaway_item.${index}.source_inv_category`,
            `table_putaway_item.${index}.target_inv_category`,
            `table_putaway_item.${index}.received_qty`,
            `table_putaway_item.${index}.item_uom`,
            `table_putaway_item.${index}.source_bin`,
            `table_putaway_item.${index}.qty_to_putaway`,
            `table_putaway_item.${index}.pending_process_qty`,
            `table_putaway_item.${index}.putaway_qty`,
            `table_putaway_item.${index}.storage_location`,
            `table_putaway_item.${index}.target_location`,
            `table_putaway_item.${index}.remark`,
          ],
          true
        );

        this.setData({
          [`table_putaway_item.${index}.storage_location`]: "",
          [`table_putaway_item.${index}.target_location`]: "",
        });
      } else if (paItem.parent_or_child === "Child") {
        if (!paItem.qi_no || paItem.qi_no === null) {
          this.disabled(
            [`table_putaway_item.${index}.target_inv_category`],
            false
          );
        }
        this.disabled([`table_putaway_item.${index}.button_split`], true);

        if (paItem.is_serialized_item === 1) {
          this.disabled(
            [
              `table_putaway_item.${index}.select_serial_number`,
              `table_putaway_item.${index}.putaway_qty`,
            ],
            true
          );
        }
      } else {
        if (!paItem.qi_no || paItem.qi_no === null) {
          this.disabled(
            [`table_putaway_item.${index}.target_inv_category`],
            false
          );
        }
        this.disabled([`table_putaway_item.${index}.button_split`], false);

        if (paItem.is_serialized_item === 1) {
          this.disabled(
            [
              `table_putaway_item.${index}.select_serial_number`,
              `table_putaway_item.${index}.putaway_qty`,
            ],
            false
          );
        }
      }
    }

    await this.closeDialog("split_dialog");
    await this.triggerEvent("func_reset_split_dialog");
  } catch (error) {
    this.$message.error(error.message || String(error));
  }
})();
