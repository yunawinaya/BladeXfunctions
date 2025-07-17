const data = this.getValues();
const fieldParts = rule.field.split(".");
const index = fieldParts[1];
const gdStatus = data.gd_status;
const order_quantity = parseFloat(data.table_gd[index].gd_order_quantity || 0);
const gd_initial_delivered_qty = parseFloat(
  data.table_gd[index].gd_initial_delivered_qty || 0
);
const gdUndeliveredQty = order_quantity - gd_initial_delivered_qty;
const quantity = value;
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

// Calculate total quantity for this material across all rows
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
      return;
    }

    // Get item data
    const itemRes = await db.collection("Item").where({ id: materialId }).get();

    if (!itemRes.data || !itemRes.data.length) {
      console.warn(`Item not found: ${materialId}`);
      window.validationState[index] = true;
      callback();
      return;
    }

    const itemData = itemRes.data[0];

    // Skip validation if stock control is disabled
    if (itemData.stock_control === 0) {
      console.log(
        `Stock control disabled for item ${materialId}, skipping inventory validation`
      );

      // Still check order limits
      let orderLimit = gdUndeliveredQty;
      if (itemData.over_delivery_tolerance > 0) {
        orderLimit =
          gdUndeliveredQty +
          gdUndeliveredQty * (itemData.over_delivery_tolerance / 100);
      }

      if (quantity > orderLimit) {
        window.validationState[index] = false;
        callback("Quantity exceeds delivery limit");
      } else {
        window.validationState[index] = true;
        callback();
      }
      return;
    }

    // Calculate order limit with tolerance
    let orderLimit = gdUndeliveredQty;
    if (itemData.over_delivery_tolerance > 0) {
      orderLimit =
        gdUndeliveredQty +
        gdUndeliveredQty * (itemData.over_delivery_tolerance / 100);
    }

    // Check order limit first (business rule validation)
    if (quantity > orderLimit) {
      console.log("Order limit exceeded:", { orderLimit, quantity });
      window.validationState[index] = false;
      callback("Quantity exceeds delivery limit");
      return;
    }

    // Check inventory availability based on GD status
    if (gdStatus === "Created") {
      // For Created status: Check total available (unrestricted + reserved)
      const resGD = await db
        .collection("goods_delivery")
        .where({ id: data.id })
        .get();

      if (!resGD?.data?.[0]?.table_gd?.[index]?.temp_qty_data) {
        window.validationState[index] = true;
        callback();
        return;
      }

      const prevTempData = JSON.parse(
        resGD.data[0].table_gd[index].temp_qty_data
      );

      if (prevTempData.length === 1) {
        const tempItem = prevTempData[0];
        const unrestricted_qty = parseFloat(tempItem.unrestricted_qty || 0);
        const reserved_qty = parseFloat(tempItem.reserved_qty || 0);

        // CORRECTED: Total available = unrestricted + reserved
        const totalAvailableQty = unrestricted_qty + reserved_qty;

        console.log(`Created GD validation for ${materialId}:`, {
          unrestricted_qty,
          reserved_qty,
          totalAvailableQty,
          currentItemQtyTotal,
        });

        if (totalAvailableQty < currentItemQtyTotal) {
          window.validationState[index] = false;
          callback(`Insufficient total inventory`);
          return;
        }
      }
    } else {
      // For other statuses (Draft, etc.): Check only unrestricted
      let availableQty = 0;

      if (itemData.item_batch_management === 0) {
        // Non-batch managed items
        const resItemBalance = await db
          .collection("item_balance")
          .where({
            plant_id: data.plant_id,
            material_id: materialId,
            is_deleted: 0,
          })
          .get();

        if (resItemBalance?.data?.length > 0) {
          // Sum up unrestricted quantities from all locations
          availableQty = resItemBalance.data.reduce((total, balance) => {
            return total + parseFloat(balance.unrestricted_qty || 0);
          }, 0);
        }
      } else {
        // Batch managed items
        const resItemBalance = await db
          .collection("item_batch_balance")
          .where({
            plant_id: data.plant_id,
            material_id: materialId,
            is_deleted: 0,
          })
          .get();

        if (resItemBalance?.data?.length > 0) {
          // Sum up unrestricted quantities from all batches/locations
          availableQty = resItemBalance.data.reduce((total, balance) => {
            return total + parseFloat(balance.unrestricted_qty || 0);
          }, 0);
        }
      }

      console.log(`Draft GD validation for ${materialId}:`, {
        availableQty,
        currentItemQtyTotal,
        batchManaged: itemData.item_batch_management === 1,
      });

      if (availableQty < currentItemQtyTotal) {
        window.validationState[index] = false;
        callback(`Insufficient unrestricted inventory`);
        return;
      }
    }

    // All validations passed
    console.log("All validations passed for:", {
      materialId,
      quantity,
      orderLimit,
    });
    window.validationState[index] = true;
    callback();
  } catch (error) {
    console.error("Error during validation:", error);
    window.validationState[index] = false;
    callback("Error checking quantity limit");
  }
})();
