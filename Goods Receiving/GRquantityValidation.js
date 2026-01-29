const { table_gr } = this.getValues();
const fieldParts = rule.field.split(".");
const index = fieldParts[1];

const materialId = table_gr[index].item_id;
const initialReceivedQty = table_gr[index].initial_received_qty;
const orderQty = table_gr[index].ordered_qty;

const remainingQty = orderQty - initialReceivedQty;

const to_received_qty = parseFloat(table_gr[index].to_received_qty || 0);

if (!window.validationState) {
  window.validationState = {};
}

const parsedValue = parseFloat(value);

(async () => {
  console.log("materialid", materialId);

  // Get GR status - skip validation for Created GRs (allow over-commitment)
  const grStatus = this.getValue("gr_status");

  // For Created GRs, don't block - just show visual feedback via to_received_qty
  if (grStatus === "Created") {
    console.log(
      "Created status - skipping validation, allowing over-commitment"
    );
    window.validationState[index] = true;
    callback();
    return;
  }

  // For Draft/Received GRs, validate normally
  if (materialId) {
    const { data } = await db
      .collection("Item")
      .where({ id: materialId })
      .get();
    console.log("data", data);
    if (
      (remainingQty * (100 + data[0].over_receive_tolerance)) / 100 <
      parsedValue
    ) {
      window.validationState[index] = false;
      callback("Quantity is not enough to receive");
      return;
    }
  }
  window.validationState[index] = true;
  callback();
})();
