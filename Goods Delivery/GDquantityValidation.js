(async () => {
  try {
    const data = this.getValues();
    const fieldParts = rule.field.split(".");
    const index = fieldParts[2];
    const rowIndex = data.gd_item_balance.row_index;
    const gdStatus = data.gd_status;

    const materialId = data.table_gd[rowIndex].material_id;
    const gd_order_quantity = parseFloat(
      data.table_gd[rowIndex].gd_order_quantity || 0
    );
    const initialDeliveredQty = parseFloat(
      data.table_gd[rowIndex].gd_initial_delivered_qty || 0
    );

    let currentDialogTotal = 0;
    for (let i = 0; i < data.gd_item_balance.table_item_balance.length; i++) {
      currentDialogTotal += parseFloat(
        data.gd_item_balance.table_item_balance[i].gd_quantity || 0
      );
    }

    const gd_delivered_qty = initialDeliveredQty + currentDialogTotal;

    const parsedValue = parseFloat(value);
    const unrestricted_field =
      data.gd_item_balance.table_item_balance[index].unrestricted_qty;
    const reserved_field =
      data.gd_item_balance.table_item_balance[index].reserved_qty;

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
        console.log("Order limit with tolerance:", orderLimit);
        console.log("Initial delivered quantity:", initialDeliveredQty);
        console.log("Current dialog total:", currentDialogTotal);
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
