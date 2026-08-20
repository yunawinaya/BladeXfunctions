// The dialog carries the fm_key of the row it was opened on. A subform row is
// identified by its key, not by where it sits, so the row is found by walking
// the tree -- an item under an item bundle is not a row of table_to at all, it
// sits under its parent's children and no index can reach it.
//
// The trailing lookup by position is only for a row the platform has not given
// a key to yet; a keyed row never reaches it.
const resolveRow = (rows, key) => {
  for (const row of rows || []) {
    if (row && String(row.fm_key) === String(key)) return row;

    const children = Array.isArray(row && row.children) ? row.children : [];

    for (const child of children) {
      if (child && String(child.fm_key) === String(key)) return child;
    }
  }

  return (rows || [])[key] || null;
};

(async () => {
  try {
    const data = this.getValues();
    const fieldParts = rule.field.split(".");
    const index = fieldParts[2];
    const rowKey = data.to_item_balance.row_index;
    const targetRow = resolveRow(data.table_to, rowKey) || {};
    const toStatus = data.to_status;

    const materialId = targetRow.material_id;
    const to_order_quantity = parseFloat(targetRow.to_order_quantity || 0);
    const initialDeliveredQty = parseFloat(
      targetRow.to_initial_delivered_qty || 0,
    );

    // Calculate total EXCLUDING the current row being validated
    let currentDialogTotal = 0;
    for (let i = 0; i < data.to_item_balance.table_item_balance.length; i++) {
      if (i !== parseInt(index)) {
        // Exclude current row
        currentDialogTotal += parseFloat(
          data.to_item_balance.table_item_balance[i].to_quantity || 0,
        );
      }
    }

    // Add the new value being validated
    const parsedValue = parseFloat(value);
    const totalWithNewValue = currentDialogTotal + parsedValue;
    const to_delivered_qty = initialDeliveredQty + totalWithNewValue;

    const unrestricted_field =
      data.to_item_balance.table_item_balance[index].unrestricted_qty;
    const reserved_field =
      data.to_item_balance.table_item_balance[index].reserved_qty;
    const locationId =
      data.to_item_balance.table_item_balance[index].location_id;
    const batchId = data.to_item_balance.table_item_balance[index].batch_id;

    if (!window.validationState) {
      window.validationState = {};
    }

    if (Object.keys(window.validationState).length === 0) {
      const rowCount = data.to_item_balance.table_item_balance.length;
      for (let i = 0; i < rowCount; i++) {
        window.validationState[i] = true;
      }
    }

    if (materialId) {
      const resItem = await db
        .collection("Item")
        .where({ id: materialId })
        .get();

      console.log("data", resItem.data);
      if (resItem.data && resItem.data[0]) {
        const orderLimit =
          (to_order_quantity *
            (100 +
              ((
                (resItem.data[0].table_uom_conversion || []).find(
                  (c) => c.alt_uom_id === targetRow.to_order_uom_id,
                ) || {}
              ).over_delivery_tolerance || 0))) /
          100;

        if (
          toStatus === "Created" &&
          reserved_field + unrestricted_field < parsedValue
        ) {
          window.validationState[index] = false;
          callback("Quantity is not enough");
          return;
        } else if (toStatus !== "Created") {
          // For Draft status, check if there's pending reserved for this SO line at this location
          const soLineItemId = targetRow.so_line_item_id;
          let pendingReservedQty = 0;

          if (soLineItemId && locationId) {
            const pendingQuery = {
              plant_id: data.plant_id,
              material_id: materialId,
              parent_line_id: soLineItemId,
              status: "Pending",
              location_id: locationId,
            };

            if (batchId) {
              pendingQuery.batch_id = batchId;
            }

            const pendingReservedRes = await db
              .collection("on_reserved_gd")
              .where(pendingQuery)
              .get();

            if (pendingReservedRes?.data?.length > 0) {
              pendingReservedQty = pendingReservedRes.data.reduce(
                (total, reserved) => total + parseFloat(reserved.open_qty || 0),
                0,
              );
            }

            console.log(
              `Pending reserved qty for SO line ${soLineItemId} at location ${locationId}:`,
              pendingReservedQty,
            );
          }

          const availableQty = unrestricted_field + pendingReservedQty;
          if (availableQty < parsedValue) {
            window.validationState[index] = false;
            callback("Unrestricted quantity is not enough");
            return;
          }
        }

        console.log("Order limit with tolerance:", orderLimit);
        console.log("Initial delivered quantity:", initialDeliveredQty);
        console.log(
          "Current dialog total (excluding current row):",
          currentDialogTotal,
        );
        console.log("New value being validated:", parsedValue);
        console.log("Total with new value:", totalWithNewValue);
        console.log("Total delivered quantity:", to_delivered_qty);

        if (orderLimit < to_delivered_qty) {
          window.validationState[index] = false;
          callback("Quantity exceeds delivery limit");
          return;
        }
      }
    }

    window.validationState[index] = true;
    callback();
  } catch (error) {
    console.error("Error during validation:", error);
    window.validationState[index] = false;
    callback("Error validating quantity");
  }
})();
