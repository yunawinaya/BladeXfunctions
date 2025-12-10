const data = this.getValues();
const fieldParts = rule.field.split(".");
const index = fieldParts[1];
const toStatus = data.to_status;
const order_quantity = parseFloat(data.table_to[index].to_order_quantity || 0);
const to_initial_delivered_qty = parseFloat(
  data.table_to[index].to_initial_delivered_qty || 0
);
const toUndeliveredQty = order_quantity - to_initial_delivered_qty;
const quantity = value;
const materialId = data.table_to[index].material_id;
const currentUOM = data.table_to[index].to_order_uom_id;

// Create or use a global validation state
if (!window.validationState) {
  window.validationState = {};
}

if (Object.keys(window.validationState).length === 0) {
  const rowCount = data.table_to.length;
  for (let i = 0; i < rowCount; i++) {
    window.validationState[i] = true;
  }
}

// Calculate total quantity for this material across all rows
let currentItemQtyTotal = 0;
for (let i = 0; i < data.table_to.length; i++) {
  if (materialId === data.table_to[i].material_id) {
    currentItemQtyTotal += parseFloat(data.table_to[i].to_qty || 0);
  }
}

(async () => {
  try {
    if (!materialId) {
      window.validationState[index] = true;
      if (quantity > toUndeliveredQty) {
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

    // Function to convert quantity to base UOM
    const convertToBaseUOM = (qty, fromUOM, itemData) => {
      if (!qty || !fromUOM || !itemData) return qty;

      const baseUOM = itemData.based_uom;
      if (fromUOM === baseUOM) return qty;

      const table_uom_conversion = itemData.table_uom_conversion;
      if (!Array.isArray(table_uom_conversion)) return qty;

      const fromConversion = table_uom_conversion.find(
        (conv) => conv.alt_uom_id === fromUOM
      );

      if (fromConversion && fromConversion.base_qty) {
        return qty * fromConversion.base_qty;
      }

      return qty;
    };

    // Convert quantities to base UOM for validation
    const quantityBase = convertToBaseUOM(quantity, currentUOM, itemData);
    const currentItemQtyTotalBase = convertToBaseUOM(
      currentItemQtyTotal,
      currentUOM,
      itemData
    );
    const toUndeliveredQtyBase = convertToBaseUOM(
      toUndeliveredQty,
      currentUOM,
      itemData
    );

    console.log("UOM Conversion Debug:", {
      originalQuantity: quantity,
      quantityBase,
      currentUOM,
      baseUOM: itemData.based_uom,
      currentItemQtyTotal,
      currentItemQtyTotalBase,
    });

    // Skip validation if stock control is disabled
    if (itemData.stock_control === 0) {
      console.log(
        `Stock control disabled for item ${materialId}, skipping inventory validation`
      );

      // Still check order limits (use base quantities)
      let orderLimitBase = toUndeliveredQtyBase;
      if (itemData.over_delivery_tolerance > 0) {
        orderLimitBase =
          toUndeliveredQtyBase +
          toUndeliveredQtyBase * (itemData.over_delivery_tolerance / 100);
      }

      if (quantityBase > orderLimitBase) {
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

    // Calculate order limit with tolerance (use base quantities)
    let orderLimitBase = toUndeliveredQtyBase;
    if (itemData.over_delivery_tolerance > 0) {
      orderLimitBase =
        toUndeliveredQtyBase +
        toUndeliveredQtyBase * (itemData.over_delivery_tolerance / 100);
    }

    // Check order limit first (business rule validation)
    if (quantityBase > orderLimitBase) {
      console.log("Order limit exceeded:", { orderLimitBase, quantityBase });
      window.validationState[index] = false;
      callback("Quantity exceeds delivery limit");
      return;
    }

    // Check inventory availability based on TO status
    if (toStatus === "Created") {
      // For Created status: Check temp_qty_data from existing TO
      const resTO = await db
        .collection("picking_plan")
        .where({ id: data.id })
        .get();

      if (!resTO?.data?.[0]?.table_to?.[index]?.temp_qty_data) {
        window.validationState[index] = true;
        callback();
        return;
      }

      const prevTempData = JSON.parse(
        resTO.data[0].table_to[index].temp_qty_data
      );

      if (prevTempData.length >= 1) {
        // For Created TO, sum up all available quantities from temp data
        let totalAvailableQty = 0;

        prevTempData.forEach((tempItem) => {
          const toUOM = data.table_to[index].to_order_uom_id;
          const unrestricted_qty_base = convertToBaseUOM(
            parseFloat(tempItem.unrestricted_qty || 0),
            toUOM,
            itemData
          );
          const reserved_qty_base = convertToBaseUOM(
            parseFloat(tempItem.reserved_qty || 0),
            toUOM,
            itemData
          );
          totalAvailableQty += unrestricted_qty_base + reserved_qty_base;
        });

        console.log(`Created TO validation for ${materialId}:`, {
          totalAvailableQty,
          currentItemQtyTotalBase,
          isSerializedItem,
        });

        if (totalAvailableQty < currentItemQtyTotalBase) {
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
          // Sum up unrestricted quantities from all serial numbers (already in base UOM)
          availableQty = resSerialBalance.data.reduce((total, balance) => {
            return total + parseFloat(balance.unrestricted_qty || 0);
          }, 0);
        }

        console.log(`Draft TO validation for SERIALIZED item ${materialId}:`, {
          availableQty,
          currentItemQtyTotalBase,
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
          // Sum up unrestricted quantities from all batches/locations (already in base UOM)
          availableQty = resItemBalance.data.reduce((total, balance) => {
            return total + parseFloat(balance.unrestricted_qty || 0);
          }, 0);
        }

        console.log(`Draft TO validation for BATCH item ${materialId}:`, {
          availableQty,
          currentItemQtyTotalBase,
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
          // Sum up unrestricted quantities from all locations (already in base UOM)
          availableQty = resItemBalance.data.reduce((total, balance) => {
            return total + parseFloat(balance.unrestricted_qty || 0);
          }, 0);
        }

        console.log(`Draft TO validation for REGULAR item ${materialId}:`, {
          availableQty,
          currentItemQtyTotalBase,
          locationCount: resItemBalance?.data?.length || 0,
        });
      }

      if (availableQty < currentItemQtyTotalBase) {
        window.validationState[index] = false;
        callback(`Insufficient unrestricted inventory`);
        return;
      }
    }

    // All validations passed
    console.log("All validations passed for:", {
      materialId,
      quantity,
      quantityBase,
      orderLimitBase,
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
