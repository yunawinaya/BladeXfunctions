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

    // 🔧 NEW: Check if item is serialized
    const isSerializedItem = itemData.serial_number_management === 1;
    const isBatchManagedItem = itemData.item_batch_management === 1;

    console.log(
      `Item ${materialId} - Serialized: ${isSerializedItem}, Batch: ${isBatchManagedItem}`
    );

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
      // For Created status: Check temp_qty_data from existing GD
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

      if (prevTempData.length >= 1) {
        // For Created GD, sum up all available quantities from temp data
        let totalAvailableQty = 0;

        prevTempData.forEach((tempItem) => {
          const unrestricted_qty = parseFloat(tempItem.unrestricted_qty || 0);
          const reserved_qty = parseFloat(tempItem.reserved_qty || 0);
          totalAvailableQty += unrestricted_qty + reserved_qty;
        });

        console.log(`Created GD validation for ${materialId}:`, {
          totalAvailableQty,
          currentItemQtyTotal,
          isSerializedItem,
        });

        if (totalAvailableQty < currentItemQtyTotal) {
          window.validationState[index] = false;
          callback(`Insufficient total inventory`);
          return;
        }
      }
    } else {
      // For other statuses (Draft, etc.): Check actual inventory balances
      let availableQty = 0;

      if (isSerializedItem) {
        // 🔧 NEW: Handle serialized items
        const resSerialBalance = await db
          .collection("item_serial_balance")
          .where({
            plant_id: data.plant_id,
            material_id: materialId,
            organization_id:
              data.organization_id || this.getVarGlobal("deptParentId"),
          })
          .get();

        if (resSerialBalance?.data?.length > 0) {
          // Sum up unrestricted quantities from all serial numbers
          availableQty = resSerialBalance.data.reduce((total, balance) => {
            return total + parseFloat(balance.unrestricted_qty || 0);
          }, 0);
        }

        console.log(`Draft GD validation for SERIALIZED item ${materialId}:`, {
          availableQty,
          currentItemQtyTotal,
          serialCount: resSerialBalance?.data?.length || 0,
        });
      } else if (isBatchManagedItem) {
        // 🔧 EXISTING: Batch managed items
        const resItemBalance = await db
          .collection("item_batch_balance")
          .where({
            plant_id: data.plant_id,
            material_id: materialId,
            organization_id:
              data.organization_id || this.getVarGlobal("deptParentId"),
          })
          .get();

        if (resItemBalance?.data?.length > 0) {
          // Sum up unrestricted quantities from all batches/locations
          availableQty = resItemBalance.data.reduce((total, balance) => {
            return total + parseFloat(balance.unrestricted_qty || 0);
          }, 0);
        }

        console.log(`Draft GD validation for BATCH item ${materialId}:`, {
          availableQty,
          currentItemQtyTotal,
          batchCount: resItemBalance?.data?.length || 0,
        });
      } else {
        // 🔧 EXISTING: Non-batch managed items
        const resItemBalance = await db
          .collection("item_balance")
          .where({
            plant_id: data.plant_id,
            material_id: materialId,
            organization_id:
              data.organization_id || this.getVarGlobal("deptParentId"),
          })
          .get();

        if (resItemBalance?.data?.length > 0) {
          // Sum up unrestricted quantities from all locations
          availableQty = resItemBalance.data.reduce((total, balance) => {
            return total + parseFloat(balance.unrestricted_qty || 0);
          }, 0);
        }

        console.log(`Draft GD validation for REGULAR item ${materialId}:`, {
          availableQty,
          currentItemQtyTotal,
          locationCount: resItemBalance?.data?.length || 0,
        });
      }

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
      isSerializedItem,
    });
    window.validationState[index] = true;
    callback();
  } catch (error) {
    console.error("Error during validation:", error);
    window.validationState[index] = false;
    callback("Error checking quantity limit");
  }
})();
