const data = this.getValues();
const fieldParts = rule.field.split(".");
const index = fieldParts[1];

const order_quantity = parseFloat(data.table_gd[index].gd_order_quantity || 0);
const delivered_quantity = parseFloat(
  data.table_gd[index].gd_delivered_qty || 0
);
const materialId = data.table_gd[index].material_id;

// Create or use a global validation state
if (!window.validationState) {
  window.validationState = {};
}

if (Object.keys(window.validationState).length === 0) {
  const rowCount = data.table_gd.length;
  for (let i = 0; i < rowCount; i++) {
    window.validationState[i] = true;
  }
}

(async () => {
  try {
    if (!materialId) {
      window.validationState[index] = true;
      callback();
      return;
    }

    const itemRes = await db.collection("Item").where({ id: materialId }).get();

    if (!itemRes.data || !itemRes.data.length) {
      console.warn(`Item not found: ${materialId}`);
      window.validationState[index] = true;
      callback();
      return;
    }

    const itemData = itemRes.data[0];
    let orderLimit = order_quantity;

    if (itemData.over_delivery_tolerance > 0) {
      orderLimit =
        order_quantity +
        order_quantity * (itemData.over_delivery_tolerance / 100);
    }

    if (delivered_quantity > orderLimit) {
      window.validationState[index] = false;
      callback("Quantity exceeds delivery limit");
    } else {
      window.validationState[index] = true;
      callback();
    }
  } catch (error) {
    console.error("Error during validation:", error);
    window.validationState[index] = false;
    callback("Error checking quantity limit");
  }
})();
