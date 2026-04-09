(async () => {
  try {
    const data = this.getValues();
    const fieldParts = rule.field.split(".");
    const index = fieldParts[2];
    const rowIndex = data.gd_item_balance.row_index;
    const isSelectPicking = data.is_select_picking;

    const materialId = data.table_gd[rowIndex].material_id;
    const gdLineUOM = data.table_gd[rowIndex].gd_order_uom_id;
    const dialogUOM =
      data.gd_item_balance.current_table_uom ||
      data.gd_item_balance.material_uom ||
      gdLineUOM;

    const rawOrderQty = parseFloat(
      data.table_gd[rowIndex].gd_order_quantity || 0,
    );
    const rawInitialDeliveredQty = parseFloat(
      data.table_gd[rowIndex].gd_initial_delivered_qty || 0,
    );

    // Calculate total EXCLUDING the current row being validated
    let currentDialogTotal = 0;
    for (let i = 0; i < data.gd_item_balance.table_item_balance.length; i++) {
      if (i !== parseInt(index)) {
        currentDialogTotal += parseFloat(
          data.gd_item_balance.table_item_balance[i].gd_quantity || 0,
        );
      }
    }

    const parsedValue = parseFloat(value);
    const totalWithNewValue = currentDialogTotal + parsedValue;

    const unrestricted_field =
      data.gd_item_balance.table_item_balance[index].unrestricted_qty;
    const reserved_field =
      data.gd_item_balance.table_item_balance[index].reserved_qty;
    const to_quantity_field =
      data.gd_item_balance.table_item_balance[index].to_quantity;

    if (!window.validationState) {
      window.validationState = {};
    }

    if (Object.keys(window.validationState).length === 0) {
      const rowCount = data.gd_item_balance.table_item_balance.length;
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
        const itemData = resItem.data[0];

        // Convert GD line quantities to dialog UOM for accurate comparison
        const convertQtyToDialogUOM = (qty) => {
          if (!qty || gdLineUOM === dialogUOM) return qty;
          const tableUOM = itemData.table_uom_conversion || [];
          const baseUOM = itemData.based_uom;
          // GD line UOM → base
          let baseQty = qty;
          if (gdLineUOM !== baseUOM) {
            const fromConv = tableUOM.find((c) => c.alt_uom_id === gdLineUOM);
            if (fromConv && fromConv.base_qty)
              baseQty = qty * fromConv.base_qty;
          }
          // base → dialog UOM
          if (dialogUOM === baseUOM) return Math.round(baseQty * 1000) / 1000;
          const toConv = tableUOM.find((c) => c.alt_uom_id === dialogUOM);
          if (toConv && toConv.base_qty)
            return Math.round((baseQty / toConv.base_qty) * 1000) / 1000;
          return qty;
        };

        const gd_order_quantity = convertQtyToDialogUOM(rawOrderQty);
        const initialDeliveredQty = convertQtyToDialogUOM(
          rawInitialDeliveredQty,
        );
        const gd_delivered_qty = initialDeliveredQty + totalWithNewValue;

        const orderLimit =
          (gd_order_quantity * (100 + itemData.over_delivery_tolerance)) / 100;

        // GDPP mode: Validate against to_quantity (picked qty from PP)
        if (isSelectPicking === 1) {
          console.log("GDPP mode validation - checking against to_quantity");

          if (to_quantity_field < parsedValue) {
            window.validationState[index] = false;
            callback("Quantity exceeds picked quantity from Picking Plan");
            return;
          }
        } else {
          // Regular GD mode: Validate against balance quantities
          console.log("Regular GD mode validation - checking against balance");

          const soLineItemId = data.table_gd[rowIndex].so_line_item_id;
          // With SO: reserved_qty shows SO-line-specific reserved (unrestricted + reserved = total available)
          // Without SO: only check unrestricted (reserved belongs to other documents)
          const availableQty = soLineItemId
            ? unrestricted_field + reserved_field
            : unrestricted_field;

          if (availableQty < parsedValue) {
            window.validationState[index] = false;
            callback("Quantity is not enough");
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
        console.log("Total delivered quantity:", gd_delivered_qty);

        if (orderLimit < gd_delivered_qty) {
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
