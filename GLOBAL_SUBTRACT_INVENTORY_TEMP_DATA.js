// ============================================================================
// GLOBAL_SUBTRACT_INVENTORY_TEMP_DATA.js
// Processes temp_qty_data and calls deductInventory/addInventory for each group
// NOTE: UOM conversion is handled by deductInventory/addInventory workflows
// ============================================================================

// Helper functions
const roundQty = (value) => parseFloat(parseFloat(value || 0).toFixed(3));
const roundPrice = (value) => parseFloat(parseFloat(value || 0).toFixed(4));

const parseJsonSafely = (jsonString, defaultValue = []) => {
  try {
    return jsonString ? JSON.parse(jsonString) : defaultValue;
  } catch (error) {
    console.error("JSON parse error:", error);
    return defaultValue;
  }
};

// ============================================================================
// MAIN FUNCTION: processBalanceTable
// ============================================================================
/**
 * Process inventory balance table for a single item using temp_qty_data
 * This function parses temp_qty_data, groups by location/batch, and calls
 * deductInventory for each group.
 *
 * @param {Object} config - Configuration object
 * @param {Object} config.item - Single item to process
 * @param {string} config.item.material_id - Item/material ID
 * @param {number} config.item.quantity - Line item total quantity
 * @param {string} config.item.alt_uom_id - Alternative UOM ID (conversion handled by workflows)
 * @param {number} config.item.unit_price - Unit price
 * @param {string} config.item.temp_qty_data - JSON string of location/batch/qty breakdown
 * @param {string} [config.item.prev_temp_qty_data] - Previous temp data for updates
 * @param {string} [config.item.parent_trx_no] - Parent transaction number
 * @param {string} [config.item.costing_method_id] - Costing method reference
 * @param {string} config.plantId - Plant ID
 * @param {string} config.organizationId - Organization ID
 * @param {string} config.transactionType - Transaction type (e.g., "GDL", "SML")
 * @param {string} config.transactionNo - Transaction number
 * @param {string} config.category - Category to deduct from (e.g., "Unrestricted", "Reserved")
 * @param {boolean} [config.isUpdate=false] - Whether this is an update operation
 * @param {Object} [config.itemData] - Item master data (if already fetched)
 * @param {Array} [config.updatedDocs] - Array to track updated docs for rollback
 * @param {Array} [config.createdDocs] - Array to track created docs for rollback
 *
 * @note UOM conversion is NOT performed here - it is handled by deductInventory/addInventory workflows
 *
 * @returns {Promise<Object>} Result object with success, itemId, processedGroups, error
 */
const processBalanceTable = async (config) => {
  const {
    item,
    plantId,
    organizationId,
    transactionType,
    transactionNo,
    category = "Unrestricted",
    isUpdate = false,
    itemData = null,
    updatedDocs = [],
    createdDocs = [],
  } = config;

  console.log(`Processing balance table for item ${item.material_id}`);

  // Input validation
  if (!item.material_id || !item.temp_qty_data) {
    console.error(`Invalid item data:`, item);
    return {
      success: false,
      itemId: item.material_id,
      processedGroups: 0,
      error: new Error("Invalid item data: missing material_id or temp_qty_data"),
    };
  }

  try {
    // Get item master data (use passed data or fetch from DB)
    let itemMaster = itemData;

    if (!itemMaster) {
      const itemRes = await db
        .collection("Item")
        .where({ id: item.material_id })
        .get();

      if (!itemRes.data || !itemRes.data.length) {
        console.error(`Item not found: ${item.material_id}`);
        return {
          success: false,
          itemId: item.material_id,
          processedGroups: 0,
          error: new Error(`Item not found: ${item.material_id}`),
        };
      }

      itemMaster = itemRes.data[0];
    }

    // Check if item should be processed based on stock_control
    if (itemMaster.stock_control === 0) {
      console.log(
        `Skipping inventory update for item ${item.material_id} (stock_control=0)`
      );
      return {
        success: true,
        itemId: item.material_id,
        processedGroups: 0,
        error: null,
      };
    }

    const isBatchManagedItem = itemMaster.item_batch_management === 1;

    const temporaryData = parseJsonSafely(item.temp_qty_data);
    const prevTempData = isUpdate
      ? parseJsonSafely(item.prev_temp_qty_data)
      : null;

    if (temporaryData.length === 0 && !(isUpdate && prevTempData && prevTempData.length > 0)) {
      console.log(`No temp_qty_data to process for item ${item.material_id}`);
      return {
        success: true,
        itemId: item.material_id,
        processedGroups: 0,
        error: null,
      };
    }

    // GROUP temp_qty_data by location + batch combination
    const groupedTempData = {};

    for (const temp of temporaryData) {
      const groupKey = isBatchManagedItem && temp.batch_id
        ? `${temp.location_id}|${temp.batch_id}`
        : temp.location_id;

      if (!groupedTempData[groupKey]) {
        groupedTempData[groupKey] = {
          location_id: temp.location_id,
          batch_id: temp.batch_id || null,
          totalQty: 0,
        };
      }

      groupedTempData[groupKey].totalQty += parseFloat(temp.quantity || 0);
    }

    // For update mode, also create groups from prevTempData if they don't exist
    const prevGroupedData = {};
    if (isUpdate && prevTempData && prevTempData.length > 0) {
      for (const prevTemp of prevTempData) {
        const prevGroupKey = isBatchManagedItem && prevTemp.batch_id
          ? `${prevTemp.location_id}|${prevTemp.batch_id}`
          : prevTemp.location_id;

        if (!prevGroupedData[prevGroupKey]) {
          prevGroupedData[prevGroupKey] = {
            location_id: prevTemp.location_id,
            batch_id: prevTemp.batch_id || null,
            totalQty: 0,
          };
        }

        prevGroupedData[prevGroupKey].totalQty += parseFloat(prevTemp.quantity || 0);

        // Add to current groups if doesn't exist (for removed locations)
        if (!groupedTempData[prevGroupKey]) {
          groupedTempData[prevGroupKey] = {
            location_id: prevTemp.location_id,
            batch_id: prevTemp.batch_id || null,
            totalQty: 0,
          };
        }
      }
    }

    const groupKeys = Object.keys(groupedTempData);
    console.log(
      `Grouped ${temporaryData.length} items into ${groupKeys.length} movement groups`
    );

    // Process each group
    // NOTE: UOM conversion is handled by deductInventory/addInventory workflows
    for (const groupKey of groupKeys) {
      const group = groupedTempData[groupKey];
      const prevGroup = prevGroupedData[groupKey];

      console.log(
        `Processing group: ${groupKey}, current qty: ${group.totalQty}, prev qty: ${prevGroup?.totalQty || 0}`
      );

      const currentQty = roundQty(group.totalQty);
      const prevQty = prevGroup ? roundQty(prevGroup.totalQty) : 0;
      const altUOM = item.alt_uom_id;

      // Determine what action to take based on quantity changes
      if (isUpdate) {
        const qtyDifference = roundQty(currentQty - prevQty);

        if (qtyDifference > 0) {
          // Quantity increased - need to deduct more
          console.log(`Quantity increased by ${qtyDifference}, deducting additional`);

          const result = await deductInventory({
            materialId: item.material_id,
            deductQty: qtyDifference,
            locationId: group.location_id,
            plantId,
            organizationId,
            transactionType,
            transactionNo,
            batchId: group.batch_id,
            category,
            altQty: qtyDifference,
            altUomId: altUOM,
            unitPrice: item.unit_price,
            parentTrxNo: item.parent_trx_no,
            costingMethodId: item.costing_method_id,
            itemData: itemMaster,
            updatedDocs,
            createdDocs,
          });

          if (!result.success) {
            throw result.error || new Error(`Failed to deduct inventory for group ${groupKey}`);
          }
        } else if (qtyDifference < 0) {
          // Quantity decreased - need to add back
          const addBackQty = Math.abs(qtyDifference);
          console.log(`Quantity decreased by ${addBackQty}, adding back to inventory`);

          const result = await addInventory({
            materialId: item.material_id,
            addQty: addBackQty,
            locationId: group.location_id,
            plantId,
            organizationId,
            transactionType,
            transactionNo,
            batchId: group.batch_id,
            category,
            altQty: addBackQty,
            altUomId: altUOM,
            unitPrice: item.unit_price,
            parentTrxNo: item.parent_trx_no,
            costingMethodId: item.costing_method_id,
            itemData: itemMaster,
            updatedDocs,
            createdDocs,
          });

          if (!result.success) {
            throw result.error || new Error(`Failed to add inventory for group ${groupKey}`);
          }
        } else {
          console.log(`No quantity change for group ${groupKey}, skipping`);
        }
      } else {
        // New record - just deduct
        if (currentQty > 0) {
          const result = await deductInventory({
            materialId: item.material_id,
            deductQty: currentQty,
            locationId: group.location_id,
            plantId,
            organizationId,
            transactionType,
            transactionNo,
            batchId: group.batch_id,
            category,
            altQty: currentQty,
            altUomId: altUOM,
            unitPrice: item.unit_price,
            parentTrxNo: item.parent_trx_no,
            costingMethodId: item.costing_method_id,
            itemData: itemMaster,
            updatedDocs,
            createdDocs,
          });

          if (!result.success) {
            throw result.error || new Error(`Failed to deduct inventory for group ${groupKey}`);
          }
        }
      }
    }

    console.log(
      `Successfully processed ${groupKeys.length} groups for item ${item.material_id}`
    );

    return {
      success: true,
      itemId: item.material_id,
      processedGroups: groupKeys.length,
      error: null,
    };
  } catch (error) {
    console.error(`Error processing item ${item.material_id}:`, error);

    // Rollback is handled by the calling deductInventory/addInventory functions
    // which already push to updatedDocs and createdDocs

    return {
      success: false,
      itemId: item.material_id,
      processedGroups: 0,
      error: error,
    };
  }
};
