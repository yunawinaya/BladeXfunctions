(async () => {
  try {
    const data = this.getValues();
    const fieldParts = rule.field.split(".");
    const index = fieldParts[2];
    const rowIndex = data.gd_item_balance.row_index;
    const gdStatus = data.gd_status;
    const isSelectPicking = data.is_select_picking;

    const materialId = data.table_gd[rowIndex].material_id;
    const gd_order_quantity = parseFloat(
      data.table_gd[rowIndex].gd_order_quantity || 0
    );
    const initialDeliveredQty = parseFloat(
      data.table_gd[rowIndex].gd_initial_delivered_qty || 0
    );

    // Calculate total EXCLUDING the current row being validated
    let currentDialogTotal = 0;
    for (let i = 0; i < data.gd_item_balance.table_item_balance.length; i++) {
      if (i !== parseInt(index)) {
        // Exclude current row
        currentDialogTotal += parseFloat(
          data.gd_item_balance.table_item_balance[i].gd_quantity || 0
        );
      }
    }

    // Add the new value being validated
    const parsedValue = parseFloat(value);
    const totalWithNewValue = currentDialogTotal + parsedValue;
    const gd_delivered_qty = initialDeliveredQty + totalWithNewValue;

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
        const orderLimit =
          (gd_order_quantity *
            (100 + resItem.data[0].over_delivery_tolerance)) /
          100;

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

          if (
            gdStatus === "Created" &&
            reserved_field + unrestricted_field < parsedValue
          ) {
            window.validationState[index] = false;
            callback("Quantity is not enough");
            return;
          } else if (gdStatus !== "Created" && unrestricted_field < parsedValue) {
            window.validationState[index] = false;
            callback("Unrestricted quantity is not enough");
            return;
          }
        }

        console.log("Order limit with tolerance:", orderLimit);
        console.log("Initial delivered quantity:", initialDeliveredQty);
        console.log(
          "Current dialog total (excluding current row):",
          currentDialogTotal
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
