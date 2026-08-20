// A subform row is identified by its fm_key, not by where it sits, and an item
// under an item bundle is not a row of table_gd at all -- it sits under its
// parent, so no position in that array reaches it. rule.field already carries
// whatever token addresses this row, so the row is read back through it rather
// than by indexing the array.
const data = this.getValues();
const fieldParts = rule.field.split(".");
const index = fieldParts[1];
const rowPath = fieldParts.slice(0, 2).join(".");
const readRow = (field) => this.getValue(`${rowPath}.${field}`);

// Every line of the document -- top-level rows and the items under a bundle. A
// material delivered both on a line of its own and inside a bundle has to count
// once for each, or the stock checks below under-count what is being asked for.
const allRows = (data.table_gd || []).flatMap((row) => [
  row,
  ...(Array.isArray(row.children) ? row.children : []),
]);

const gdStatus = data.gd_status;
const isSelectPicking = data.is_select_picking;
const order_quantity = parseFloat(readRow("gd_order_quantity") || 0);
const gd_initial_delivered_qty = parseFloat(
  readRow("gd_initial_delivered_qty") || 0,
);
const gdUndeliveredQty = order_quantity - gd_initial_delivered_qty;
const quantity = value;
const materialId = readRow("material_id");
const currentUOM = readRow("gd_order_uom_id");
const soLineItemId = readRow("so_line_item_id");

// Create or use a global validation state
if (!window.validationState) {
  window.validationState = {};
}

if (Object.keys(window.validationState).length === 0) {
  const rowCount = allRows.length;
  for (let i = 0; i < rowCount; i++) {
    window.validationState[i] = true;
  }
}

// Calculate total quantity for this material across all rows
let currentItemQtyTotal = 0;
for (let i = 0; i < allRows.length; i++) {
  if (materialId === allRows[i].material_id) {
    currentItemQtyTotal += parseFloat(allRows[i].gd_qty || 0);
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

    // Function to convert quantity to base UOM
    const convertToBaseUOM = (qty, fromUOM, itemData) => {
      if (!qty || !fromUOM || !itemData) return qty;

      const baseUOM = itemData.based_uom;
      if (fromUOM === baseUOM) return qty;

      const table_uom_conversion = itemData.table_uom_conversion;
      if (!Array.isArray(table_uom_conversion)) return qty;

      const fromConversion = table_uom_conversion.find(
        (conv) => conv.alt_uom_id === fromUOM,
      );

      if (fromConversion && fromConversion.base_qty) {
        return qty * fromConversion.base_qty;
      }

      return qty;
    };

    // Convert quantities to base UOM for validation
    const quantityBase = convertToBaseUOM(quantity, currentUOM, itemData);
    const currentItemQtyTotalBase = allRows.reduce((s, r) => materialId === r.material_id ? s + convertToBaseUOM(parseFloat(r.gd_qty || 0), r.gd_order_uom_id, itemData) : s, 0);
    const orderQtyBase = convertToBaseUOM(order_quantity, currentUOM, itemData);
    const initialDeliveredQtyBase = convertToBaseUOM(
      gd_initial_delivered_qty,
      currentUOM,
      itemData,
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
        `Stock control disabled for item ${materialId}, skipping inventory validation`,
      );

      // Still check order limits (use base quantities)
      const orderLimitBase =
        orderQtyBase * (1 + (((itemData.table_uom_conversion || []).find((c) => c.alt_uom_id === currentUOM) || {}).over_delivery_tolerance || 0) / 100) -
        initialDeliveredQtyBase;

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
      `Item ${materialId} - Serialized: ${isSerializedItem}, Batch: ${isBatchManagedItem}`,
    );

    // Calculate order limit with tolerance (use base quantities)
    const orderLimitBase =
      orderQtyBase * (1 + (((itemData.table_uom_conversion || []).find((c) => c.alt_uom_id === currentUOM) || {}).over_delivery_tolerance || 0) / 100) -
      initialDeliveredQtyBase;

    // Check order limit first (business rule validation)
    if (quantityBase > orderLimitBase) {
      console.log("Order limit exceeded:", { orderLimitBase, quantityBase });
      window.validationState[index] = false;
      callback("Quantity exceeds delivery limit");
      return;
    }

    // GDPP mode: Validate against to_quantity from PP's temp_qty_data
    if (isSelectPicking === 1) {
      console.log(`GDPP mode validation for item ${materialId}`);

      const tempQtyData = readRow("temp_qty_data");

      if (!tempQtyData || tempQtyData === "[]" || tempQtyData.trim() === "") {
        console.warn(`Row ${index}: No temp_qty_data from PP`);
        window.validationState[index] = true;
        callback();
        return;
      }

      try {
        const tempDataArray = JSON.parse(tempQtyData);

        // Calculate total to_quantity (ceiling from PP) in base UOM
        const totalToQuantityBase = tempDataArray.reduce((sum, item) => {
          const itemToQty = parseFloat(item.to_quantity || 0);
          // temp_qty_data is in goodDeliveryUOM, convert to base
          return sum + convertToBaseUOM(itemToQty, currentUOM, itemData);
        }, 0);

        console.log(`GDPP validation for ${materialId}:`, {
          quantityBase,
          totalToQuantityBase,
          currentItemQtyTotalBase,
        });

        // Validate: total gd_qty cannot exceed total to_quantity from PP
        if (quantityBase > totalToQuantityBase) {
          window.validationState[index] = false;
          callback("Quantity exceeds picked quantity from Picking Plan");
          return;
        }

        // All validations passed for GDPP mode
        console.log("GDPP validation passed for:", materialId);
        window.validationState[index] = true;
        callback();
        return;
      } catch (error) {
        console.error(
          `Error parsing temp_qty_data for GDPP validation:`,
          error,
        );
        window.validationState[index] = false;
        callback("Error validating quantity");
        return;
      }
    }

    // Regular GD mode: Check inventory availability based on GD status
    if (gdStatus === "Created") {
      // For Created status: Check temp_qty_data from existing GD
      const resGD = await db
        .collection("goods_delivery")
        .where({ id: data.id })
        .get();

      // Matched by sales order line rather than by position: the stored delivery
      // is a tree, and an item under a bundle has no position in table_gd.
      const storedRows = (resGD?.data?.[0]?.table_gd || []).flatMap((row) => [
        row,
        ...(Array.isArray(row.children) ? row.children : []),
      ]);
      const storedRow =
        storedRows.find((row) => row.so_line_item_id === soLineItemId) || null;

      if (!storedRow?.temp_qty_data) {
        window.validationState[index] = true;
        callback();
        return;
      }

      const prevTempData = JSON.parse(storedRow.temp_qty_data);

      if (prevTempData.length >= 1) {
        // For Created GD, sum up all available quantities from temp data
        let totalAvailableQty = 0;

        prevTempData.forEach((tempItem) => {
          // temp_qty_data is already in goodDeliveryUOM, convert to base for validation
          const gdUOM = currentUOM;
          const unrestricted_qty_base = convertToBaseUOM(
            parseFloat(tempItem.unrestricted_qty || 0),
            gdUOM,
            itemData,
          );
          const reserved_qty_base = convertToBaseUOM(
            parseFloat(tempItem.reserved_qty || 0),
            gdUOM,
            itemData,
          );
          totalAvailableQty += unrestricted_qty_base + reserved_qty_base;
        });

        console.log(`Created GD validation for ${materialId}:`, {
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

      // 🔧 NEW: Fetch pending reserved data for this SO line item
      // Reserved stock for this SO should be counted as available
      let pendingReservedQty = 0;

      if (soLineItemId) {
        const pendingReservedRes = await db
          .collection("on_reserved_gd")
          .where({
            plant_id: data.plant_id,
            material_id: materialId,
            parent_line_id: soLineItemId,
            status: "Pending",
          })
          .get();

        if (pendingReservedRes?.data?.length > 0) {
          pendingReservedQty = pendingReservedRes.data.reduce((total, reserved) => {
            return total + parseFloat(reserved.open_qty || 0);
          }, 0);
        }

        console.log(`Pending reserved qty for SO line ${soLineItemId}:`, pendingReservedQty);
      }

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

        // 🔧 NEW: Add pending reserved qty (reserved stock is available for this SO)
        availableQty += pendingReservedQty;

        console.log(`Draft GD validation for SERIALIZED item ${materialId}:`, {
          unrestrictedQty: availableQty - pendingReservedQty,
          pendingReservedQty,
          totalAvailableQty: availableQty,
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

        // 🔧 NEW: Add pending reserved qty (reserved stock is available for this SO)
        availableQty += pendingReservedQty;

        console.log(`Draft GD validation for BATCH item ${materialId}:`, {
          unrestrictedQty: availableQty - pendingReservedQty,
          pendingReservedQty,
          totalAvailableQty: availableQty,
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

        // 🔧 NEW: Add pending reserved qty (reserved stock is available for this SO)
        availableQty += pendingReservedQty;

        console.log(`Draft GD validation for REGULAR item ${materialId}:`, {
          unrestrictedQty: availableQty - pendingReservedQty,
          pendingReservedQty,
          totalAvailableQty: availableQty,
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
