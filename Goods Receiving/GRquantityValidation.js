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
