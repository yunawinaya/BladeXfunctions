(async () => {
  try {
    const data = this.getValues();
    const fieldParts = rule.field.split(".");
    const index = fieldParts[2];
    const rowIndex = data.to_item_balance.row_index;
    const toStatus = data.to_status;

    const materialId = data.table_to[rowIndex].material_id;
    const to_order_quantity = parseFloat(
      data.table_to[rowIndex].to_order_quantity || 0
    );
    const initialDeliveredQty = parseFloat(
      data.table_to[rowIndex].to_initial_delivered_qty || 0
    );

    // Calculate total EXCLUDING the current row being validated
    let currentDialogTotal = 0;
    for (let i = 0; i < data.to_item_balance.table_item_balance.length; i++) {
      if (i !== parseInt(index)) {
        // Exclude current row
        currentDialogTotal += parseFloat(
          data.to_item_balance.table_item_balance[i].to_quantity || 0
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
            (100 + resItem.data[0].over_delivery_tolerance)) /
          100;

        if (
          toStatus === "Created" &&
          reserved_field + unrestricted_field < parsedValue
        ) {
          window.validationState[index] = false;
          callback("Quantity is not enough");
          return;
        } else if (toStatus !== "Created" && unrestricted_field < parsedValue) {
          window.validationState[index] = false;
          callback("Unrestricted quantity is not enough");
          return;
        }

        console.log("Order limit with tolerance:", orderLimit);
        console.log("Initial delivered quantity:", initialDeliveredQty);
        console.log(
          "Current dialog total (excluding current row):",
          currentDialogTotal
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
