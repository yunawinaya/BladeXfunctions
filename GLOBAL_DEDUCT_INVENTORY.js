// ============================================================================
// GLOBAL_DEDUCT_INVENTORY.js
// Simple global function to deduct inventory from any category
// ============================================================================

// For quantities - 3 decimal places
const roundQty = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(3));
};

// For prices - 4 decimal places
const roundPrice = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(4));
};

// Category constants
const INVENTORY_CATEGORIES = {
  UNRESTRICTED: "Unrestricted",
  RESERVED: "Reserved",
  BLOCKED: "Blocked",
  QUALITY_INSPECTION: "Quality Inspection",
  IN_TRANSIT: "In Transit",
};

// Map category names to database field names
const CATEGORY_FIELD_MAP = {
  Unrestricted: "unrestricted_qty",
  Reserved: "reserved_qty",
  Blocked: "block_qty",
  "Quality Inspection": "qualityinsp_qty",
  "In Transit": "intransit_qty",
};

// ============================================================================
// COSTING FUNCTIONS
// ============================================================================

// Get latest FIFO cost price
const getLatestFIFOCostPrice = async (materialId, batchId, deductionQty, plantId) => {
  try {
    const query = batchId
      ? db.collection("fifo_costing_history").where({
          material_id: materialId,
          batch_id: batchId,
          plant_id: plantId,
        })
      : db.collection("fifo_costing_history").where({
          material_id: materialId,
          plant_id: plantId,
        });

    const response = await query.get();
    const result = response.data;

    if (result && Array.isArray(result) && result.length > 0) {
      // Sort by FIFO sequence (lowest/oldest first)
      const sortedRecords = result.sort(
        (a, b) => a.fifo_sequence - b.fifo_sequence
      );

      // If no deduction quantity, return first available record's cost
      if (!deductionQty) {
        for (const record of sortedRecords) {
          const availableQty = roundQty(record.fifo_available_quantity || 0);
          if (availableQty > 0) {
            return roundPrice(record.fifo_cost_price || 0);
          }
        }
        return roundPrice(sortedRecords[sortedRecords.length - 1].fifo_cost_price || 0);
      }

      // Calculate weighted average cost across FIFO records
      let remainingQtyToDeduct = roundQty(deductionQty);
      let totalCost = 0;
      let totalDeductedQty = 0;

      for (const record of sortedRecords) {
        if (remainingQtyToDeduct <= 0) break;

        const availableQty = roundQty(record.fifo_available_quantity || 0);
        if (availableQty <= 0) continue;

        const costPrice = roundPrice(record.fifo_cost_price || 0);
        const qtyToDeduct = Math.min(availableQty, remainingQtyToDeduct);

        totalCost = roundPrice(totalCost + qtyToDeduct * costPrice);
        totalDeductedQty = roundQty(totalDeductedQty + qtyToDeduct);
        remainingQtyToDeduct = roundQty(remainingQtyToDeduct - qtyToDeduct);
      }

      // Handle remaining quantity with last record's price
      if (remainingQtyToDeduct > 0 && sortedRecords.length > 0) {
        const lastCostPrice = roundPrice(
          sortedRecords[sortedRecords.length - 1].fifo_cost_price || 0
        );
        totalCost = roundPrice(totalCost + remainingQtyToDeduct * lastCostPrice);
        totalDeductedQty = roundQty(totalDeductedQty + remainingQtyToDeduct);
      }

      if (totalDeductedQty > 0) {
        return roundPrice(totalCost / totalDeductedQty);
      }

      return roundPrice(sortedRecords[0].fifo_cost_price || 0);
    }

    console.warn(`No FIFO records found for material ${materialId}`);
    return 0;
  } catch (error) {
    console.error(`Error retrieving FIFO cost price for ${materialId}:`, error);
    return 0;
  }
};

// Get Weighted Average cost price
const getWeightedAverageCostPrice = async (materialId, batchId, plantId) => {
  try {
    const query = batchId
      ? db.collection("wa_costing_method").where({
          material_id: materialId,
          batch_id: batchId,
          plant_id: plantId,
        })
      : db.collection("wa_costing_method").where({
          material_id: materialId,
          plant_id: plantId,
        });

    const response = await query.get();
    const waData = response.data;

    if (waData && Array.isArray(waData) && waData.length > 0) {
      // Sort by date (newest first)
      waData.sort((a, b) => {
        if (a.created_at && b.created_at) {
          return new Date(b.created_at) - new Date(a.created_at);
        }
        return 0;
      });

      return roundPrice(waData[0].wa_cost_price || 0);
    }

    console.warn(`No weighted average records found for material ${materialId}`);
    return 0;
  } catch (error) {
    console.error(`Error retrieving WA cost price for ${materialId}:`, error);
    return 0;
  }
};

// Get Fixed cost price
const getFixedCostPrice = async (materialId) => {
  try {
    const response = await db.collection("Item").where({ id: materialId }).get();
    const result = response.data;

    if (result && result.length > 0) {
      return roundPrice(parseFloat(result[0].purchase_unit_price || 0));
    }

    return 0;
  } catch (error) {
    console.error(`Error retrieving fixed cost price for ${materialId}:`, error);
    return 0;
  }
};

// ============================================================================
// COSTING UPDATE FUNCTIONS
// ============================================================================

// Update FIFO inventory
const updateFIFOInventory = async (materialId, deductQty, batchId, plantId) => {
  try {
    const query = batchId
      ? db.collection("fifo_costing_history").where({
          material_id: materialId,
          batch_id: batchId,
          plant_id: plantId,
        })
      : db.collection("fifo_costing_history").where({
          material_id: materialId,
          plant_id: plantId,
        });

    const response = await query.get();
    const result = response.data;

    if (result && Array.isArray(result) && result.length > 0) {
      // Sort by FIFO sequence (oldest first)
      const sortedRecords = result.sort(
        (a, b) => a.fifo_sequence - b.fifo_sequence
      );

      let remainingQtyToDeduct = parseFloat(deductQty);

      for (const record of sortedRecords) {
        if (remainingQtyToDeduct <= 0) break;

        const availableQty = roundQty(record.fifo_available_quantity || 0);
        if (availableQty <= 0) continue;

        const qtyToDeduct = Math.min(availableQty, remainingQtyToDeduct);
        const newAvailableQty = roundQty(availableQty - qtyToDeduct);

        await db.collection("fifo_costing_history").doc(record.id).update({
          fifo_available_quantity: newAvailableQty,
        });

        remainingQtyToDeduct = roundQty(remainingQtyToDeduct - qtyToDeduct);
      }

      if (remainingQtyToDeduct > 0) {
        console.warn(
          `Warning: Couldn't fully satisfy FIFO deduction. Remaining: ${remainingQtyToDeduct}`
        );
      }
    } else {
      console.warn(`No FIFO records found for material ${materialId}`);
    }
  } catch (error) {
    console.error(`Error updating FIFO for material ${materialId}:`, error);
    throw error;
  }
};

// Update Weighted Average inventory
const updateWeightedAverage = async (materialId, batchId, deductQty, plantId) => {
  if (!materialId || isNaN(parseFloat(deductQty)) || parseFloat(deductQty) <= 0) {
    console.error("Invalid data for weighted average update:", { materialId, deductQty });
    return;
  }

  try {
    const query = batchId
      ? db.collection("wa_costing_method").where({
          material_id: materialId,
          batch_id: batchId,
          plant_id: plantId,
        })
      : db.collection("wa_costing_method").where({
          material_id: materialId,
          plant_id: plantId,
        });

    const response = await query.get();
    const waData = response.data;

    if (!waData || !Array.isArray(waData) || waData.length === 0) {
      console.warn(`No weighted average records found for material ${materialId}`);
      return;
    }

    // Sort by date (newest first)
    waData.sort((a, b) => {
      if (a.created_at && b.created_at) {
        return new Date(b.created_at) - new Date(a.created_at);
      }
      return 0;
    });

    const waDoc = waData[0];
    const waQuantity = roundQty(waDoc.wa_quantity || 0);
    const newWaQuantity = Math.max(0, roundQty(waQuantity - deductQty));

    await db.collection("wa_costing_method").doc(waDoc.id).update({
      wa_quantity: newWaQuantity,
      updated_at: new Date(),
    });

    console.log(
      `Updated Weighted Average for ${materialId}: ${waQuantity} -> ${newWaQuantity}`
    );
  } catch (error) {
    console.error(`Error updating WA for material ${materialId}:`, error);
    throw error;
  }
};

// ============================================================================
// MAIN FUNCTION: deductInventory
// ============================================================================
/**
 * Deduct inventory from a specific category
 *
 * @param {Object} config - Configuration object
 * @param {string} config.materialId - Item/material ID (required)
 * @param {number} config.deductQty - Quantity to deduct in base UOM (required)
 * @param {string} config.locationId - Bin/Location ID (required)
 * @param {string} config.plantId - Plant ID (required)
 * @param {string} config.organizationId - Organization ID (required)
 * @param {string} config.transactionType - Transaction type e.g., "GDL", "SML" (required)
 * @param {string} config.transactionNo - Transaction/document number (required)
 * @param {string} [config.batchId] - Batch ID (if batch-managed item)
 * @param {string} [config.category="Unrestricted"] - Category to deduct from
 * @param {number} [config.altQty] - Alternative UOM quantity (for movement record)
 * @param {string} [config.altUomId] - Alternative UOM ID
 * @param {number} [config.unitPrice] - Unit price (for movement record)
 * @param {string} [config.parentTrxNo] - Parent transaction number
 * @param {string} [config.costingMethodId] - Costing method reference
 * @param {Object} [config.itemData] - Item master data (if already fetched, to avoid redundant DB call)
 * @param {Array} [config.updatedDocs] - Array to track updated docs for rollback
 * @param {Array} [config.createdDocs] - Array to track created docs for rollback
 *
 * @returns {Promise<Object>} Result object with success, materialId, deductedQty, error
 */
const deductInventory = async (config) => {
  const {
    materialId,
    deductQty,
    locationId,
    plantId,
    organizationId,
    transactionType,
    transactionNo,
    batchId = null,
    category = "Unrestricted",
    altQty = null,
    altUomId = null,
    unitPrice = null,
    parentTrxNo = null,
    costingMethodId = null,
    itemData = null,
    updatedDocs = [],
    createdDocs = [],
  } = config;

  console.log(`Deducting ${deductQty} from ${category} for item ${materialId}`);

  // Input validation
  if (!materialId || !locationId || !plantId || !organizationId || !transactionType || !transactionNo) {
    return {
      success: false,
      materialId,
      deductedQty: 0,
      error: new Error("Missing required fields"),
    };
  }

  if (!deductQty || deductQty <= 0) {
    return {
      success: false,
      materialId,
      deductedQty: 0,
      error: new Error("Deduct quantity must be greater than 0"),
    };
  }

  // Validate category
  const categoryField = CATEGORY_FIELD_MAP[category];
  if (!categoryField) {
    return {
      success: false,
      materialId,
      deductedQty: 0,
      error: new Error(`Invalid category: ${category}. Valid categories: ${Object.keys(CATEGORY_FIELD_MAP).join(", ")}`),
    };
  }

  try {
    // Step 1: Get item master data (use passed data or fetch from DB)
    let item = itemData;

    if (!item) {
      const itemRes = await db.collection("Item").where({ id: materialId }).get();

      if (!itemRes.data || !itemRes.data.length) {
        return {
          success: false,
          materialId,
          deductedQty: 0,
          error: new Error(`Item not found: ${materialId}`),
        };
      }

      item = itemRes.data[0];
    }

    // Check stock_control
    if (item.stock_control === 0) {
      console.log(`Item ${materialId} is non-stock-controlled, skipping deduction`);
      return {
        success: true,
        materialId,
        deductedQty: 0,
        error: null,
      };
    }

    const costingMethod = item.material_costing_method;
    const baseUOM = item.based_uom;

    // Step 2: Query current balance
    const balanceParams = {
      material_id: materialId,
      location_id: locationId,
      plant_id: plantId,
      organization_id: organizationId,
    };

    let balanceCollection = "item_balance";
    if (batchId) {
      balanceParams.batch_id = batchId;
      balanceCollection = "item_batch_balance";
    }

    const balanceQuery = await db.collection(balanceCollection).where(balanceParams).get();

    if (!balanceQuery.data || !balanceQuery.data.length) {
      return {
        success: false,
        materialId,
        deductedQty: 0,
        error: new Error(`No balance found for item ${materialId} at location ${locationId}`),
      };
    }

    const existingBalance = balanceQuery.data[0];
    const currentCategoryQty = roundQty(existingBalance[categoryField] || 0);
    const currentBalanceQty = roundQty(existingBalance.balance_quantity || 0);

    // Check sufficient quantity
    if (currentCategoryQty < deductQty) {
      return {
        success: false,
        materialId,
        deductedQty: 0,
        error: new Error(
          `Insufficient ${category} quantity for ${materialId}. Available: ${currentCategoryQty}, Requested: ${deductQty}`
        ),
      };
    }

    // Step 3: Get costing price
    let calculatedUnitPrice = unitPrice || 0;
    let totalPrice = 0;

    if (costingMethod === "First In First Out") {
      calculatedUnitPrice = await getLatestFIFOCostPrice(materialId, batchId, deductQty, plantId);
    } else if (costingMethod === "Weighted Average") {
      calculatedUnitPrice = await getWeightedAverageCostPrice(materialId, batchId, plantId);
    } else if (costingMethod === "Fixed Cost") {
      calculatedUnitPrice = await getFixedCostPrice(materialId);
    }

    totalPrice = roundPrice(calculatedUnitPrice * deductQty);

    // Step 4: Create inventory movement record
    const movementData = {
      transaction_type: transactionType,
      trx_no: transactionNo,
      parent_trx_no: parentTrxNo,
      movement: "OUT",
      inventory_category: category,
      item_id: materialId,
      quantity: altQty || deductQty,
      uom_id: altUomId || baseUOM,
      base_qty: deductQty,
      base_uom_id: baseUOM,
      unit_price: calculatedUnitPrice,
      total_price: totalPrice,
      bin_location_id: locationId,
      batch_number_id: batchId,
      costing_method_id: costingMethodId,
      plant_id: plantId,
      organization_id: organizationId,
      is_deleted: 0,
    };

    await db.collection("inventory_movement").add(movementData);

    // Get created movement ID for rollback tracking
    await new Promise((resolve) => setTimeout(resolve, 100));

    const movementQuery = await db
      .collection("inventory_movement")
      .where({
        transaction_type: transactionType,
        trx_no: transactionNo,
        movement: "OUT",
        inventory_category: category,
        item_id: materialId,
        bin_location_id: locationId,
        base_qty: deductQty,
        plant_id: plantId,
        organization_id: organizationId,
      })
      .get();

    if (movementQuery.data && movementQuery.data.length > 0) {
      const movementId = movementQuery.data.sort(
        (a, b) => new Date(b.create_time) - new Date(a.create_time)
      )[0].id;

      createdDocs.push({
        collection: "inventory_movement",
        docId: movementId,
      });
    }

    // Step 5: Update balance
    const newCategoryQty = roundQty(currentCategoryQty - deductQty);
    const newBalanceQty = roundQty(currentBalanceQty - deductQty);

    // Track original data for rollback
    updatedDocs.push({
      collection: balanceCollection,
      docId: existingBalance.id,
      originalData: {
        [categoryField]: currentCategoryQty,
        balance_quantity: currentBalanceQty,
      },
    });

    await db.collection(balanceCollection).doc(existingBalance.id).update({
      [categoryField]: newCategoryQty,
      balance_quantity: newBalanceQty,
    });

    console.log(
      `Updated ${balanceCollection}: ${category} ${currentCategoryQty} -> ${newCategoryQty}, Balance ${currentBalanceQty} -> ${newBalanceQty}`
    );

    // Step 6: For batch items, also update aggregated item_balance
    if (balanceCollection === "item_batch_balance" && batchId) {
      const generalBalanceParams = {
        material_id: materialId,
        location_id: locationId,
        plant_id: plantId,
        organization_id: organizationId,
      };

      const generalBalanceQuery = await db
        .collection("item_balance")
        .where(generalBalanceParams)
        .get();

      if (generalBalanceQuery.data && generalBalanceQuery.data.length > 0) {
        const generalBalance = generalBalanceQuery.data[0];
        const currentGeneralCategoryQty = roundQty(generalBalance[categoryField] || 0);
        const currentGeneralBalanceQty = roundQty(generalBalance.balance_quantity || 0);

        const newGeneralCategoryQty = roundQty(currentGeneralCategoryQty - deductQty);
        const newGeneralBalanceQty = roundQty(currentGeneralBalanceQty - deductQty);

        updatedDocs.push({
          collection: "item_balance",
          docId: generalBalance.id,
          originalData: {
            [categoryField]: currentGeneralCategoryQty,
            balance_quantity: currentGeneralBalanceQty,
          },
        });

        await db.collection("item_balance").doc(generalBalance.id).update({
          [categoryField]: newGeneralCategoryQty,
          balance_quantity: newGeneralBalanceQty,
        });

        console.log(
          `Updated item_balance (aggregated): ${category} ${currentGeneralCategoryQty} -> ${newGeneralCategoryQty}`
        );
      }
    }

    // Step 7: Update costing method
    if (costingMethod === "First In First Out") {
      await updateFIFOInventory(materialId, deductQty, batchId, plantId);
    } else if (costingMethod === "Weighted Average") {
      await updateWeightedAverage(materialId, batchId, deductQty, plantId);
    }

    console.log(`Successfully deducted ${deductQty} from ${category} for item ${materialId}`);

    return {
      success: true,
      materialId,
      deductedQty: deductQty,
      error: null,
    };
  } catch (error) {
    console.error(`Error deducting inventory for ${materialId}:`, error);

    // Rollback updates
    for (const doc of updatedDocs.reverse()) {
      try {
        await db.collection(doc.collection).doc(doc.docId).update(doc.originalData);
      } catch (rollbackError) {
        console.error("Rollback error:", rollbackError);
      }
    }

    // Mark created docs as deleted
    for (const doc of createdDocs.reverse()) {
      try {
        await db.collection(doc.collection).doc(doc.docId).update({ is_deleted: 1 });
      } catch (rollbackError) {
        console.error("Rollback error:", rollbackError);
      }
    }

    return {
      success: false,
      materialId,
      deductedQty: 0,
      error,
    };
  }
};
