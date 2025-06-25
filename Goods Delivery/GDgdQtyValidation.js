const data = this.getValues();
const fieldParts = rule.field.split(".");
const index = fieldParts[1];
const gdStatus = data.gd_status;
const order_quantity = parseFloat(data.table_gd[index].gd_order_quantity || 0);
const gd_undelivered_qty = parseFloat(
  data.table_gd[index].gd_undelivered_qty || 0
);
const gd_initial_delivered_qty = parseFloat(
  data.table_gd[index].gd_initial_delivered_qty || 0
);
const gdUndeliveredQty = order_quantity - gd_initial_delivered_qty;
const quantity = value;
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

let currentItemQtyTotal = 0;
for (let i = 0; i < data.table_gd.length; i++) {
  if (materialId === data.table_gd[i].material_id) {
    currentItemQtyTotal += parseFloat(data.table_gd[i].gd_qty || 0);
  }
}

(async () => {
  try {
    if (!materialId) {
      window.validationState[index] = true;
      if (quantity > gdUndeliveredQty) {
        window.validationState[index] = false;
        callback("Quantity exceed delivered limit.");
      } else {
        window.validationState[index] = true;
        callback();
      }
    } else {
      const itemRes = await db
        .collection("Item")
        .where({ id: materialId })
        .get();

      if (!itemRes.data || !itemRes.data.length) {
        console.warn(`Item not found: ${materialId}`);
        window.validationState[index] = true;
        callback();
        return;
      }

      const itemData = itemRes.data[0];
      let orderLimit = gdUndeliveredQty;

      if (itemData.over_delivery_tolerance > 0) {
        orderLimit =
          gdUndeliveredQty +
          gdUndeliveredQty * (itemData.over_delivery_tolerance / 100);
      }

      if (gdStatus === "Created") {
        const resGD = await db
          .collection("goods_delivery")
          .where({ id: data.id })
          .get();

        const prevGDQty = resGD?.data[0]?.table_gd[index]?.gd_qty;
        const prevTempData = JSON.parse(
          resGD?.data[0]?.table_gd[index]?.temp_qty_data
        );

        if (prevTempData.length === 1) {
          const unrestricted_field = prevTempData[0].unrestricted_qty;
          const reserved_field = prevTempData[0].reserved_qty;

          if (
            reserved_field - prevGDQty + unrestricted_field <
            currentItemQtyTotal
          ) {
            window.validationState[index] = false;
            callback("Quantity is not enough");
          } else {
            window.validationState[index] = true;
            callback();
          }
        } else {
          window.validationState[index] = true;
          callback();
        }
      } else {
        if (itemData.item_batch_management === 0) {
          const resItemBalance = await db
            .collection("item_balance")
            .where({
              plant_id: data.plant_id,
              material_id: materialId,
              is_deleted: 0,
            })
            .get();

          if (resItemBalance?.data?.length === 1) {
            const balanceData = resItemBalance.data[0];

            const unrestricted_field = balanceData.unrestricted_qty;

            if (unrestricted_field < currentItemQtyTotal) {
              window.validationState[index] = false;
              callback("Unrestricted quantity is not enough");
            } else {
              window.validationState[index] = true;
              callback();
            }
          }
        } else if (itemData.item_batch_management === 1) {
          const resItemBalance = await db
            .collection("item_batch_balance")
            .where({
              plant_id: data.plant_id,
              material_id: materialId,
              is_deleted: 0,
            })
            .get();

          if (resItemBalance?.data?.length === 1) {
            const balanceData = resItemBalance.data[0];

            const unrestricted_field = balanceData.unrestricted_qty;

            if (unrestricted_field < currentItemQtyTotal) {
              window.validationState[index] = false;
              callback("Unrestricted quantity is not enough");
            } else {
              window.validationState[index] = true;
              callback();
            }
          }
        }
      }

      if (quantity > orderLimit) {
        console.log("orderLimit", orderLimit);
        window.validationState[index] = false;
        callback("Quantity exceeds delivery limit");
      } else {
        console.log("orderLimit", orderLimit);
        console.log("deliveredQty", quantity);

        window.validationState[index] = true;
        callback();
      }
    }
  } catch (error) {
    console.error("Error during validation:", error);
    window.validationState[index] = false;
    callback("Error checking quantity limit");
  }
})();
