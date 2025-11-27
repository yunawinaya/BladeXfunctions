const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const getPrefixData = async (organizationId, documentType = "Packing") => {
  console.log("Getting prefix data for organization:", organizationId);
  try {
    const prefixEntry = await db
      .collection("prefix_configuration")
      .where({
        document_types: documentType,
        is_deleted: 0,
        organization_id: organizationId,
        is_active: 1,
      })
      .get();

    console.log("Prefix data result:", prefixEntry);

    if (!prefixEntry.data || prefixEntry.data.length === 0) {
      console.log("No prefix configuration found");
      return null;
    }

    return prefixEntry.data[0];
  } catch (error) {
    console.error("Error getting prefix data:", error);
    throw error;
  }
};

const updatePrefix = async (
  organizationId,
  runningNumber,
  documentType = "Packing"
) => {
  console.log(
    "Updating prefix for organization:",
    organizationId,
    "with running number:",
    runningNumber
  );
  try {
    await db
      .collection("prefix_configuration")
      .where({
        document_types: documentType,
        is_deleted: 0,
        organization_id: organizationId,
      })
      .update({
        running_number: parseInt(runningNumber) + 1,
        has_record: 1,
      });
    console.log("Prefix update successful");
  } catch (error) {
    console.error("Error updating prefix:", error);
    throw error;
  }
};

const generatePrefix = (runNumber, now, prefixData) => {
  console.log("Generating prefix with running number:", runNumber);
  try {
    let generated = prefixData.current_prefix_config;
    generated = generated.replace("prefix", prefixData.prefix_value);
    generated = generated.replace("suffix", prefixData.suffix_value);
    generated = generated.replace(
      "month",
      String(now.getMonth() + 1).padStart(2, "0")
    );
    generated = generated.replace(
      "day",
      String(now.getDate()).padStart(2, "0")
    );
    generated = generated.replace("year", now.getFullYear());
    generated = generated.replace(
      "running_number",
      String(runNumber).padStart(prefixData.padding_zeroes, "0")
    );
    console.log("Generated prefix:", generated);
    return generated;
  } catch (error) {
    console.error("Error generating prefix:", error);
    throw error;
  }
};

const checkUniqueness = async (
  generatedPrefix,
  organizationId,
  collection = "packing",
  prefix = "packing_no"
) => {
  const existingDoc = await db
    .collection(collection)
    .where({
      [prefix]: generatedPrefix,
      organization_id: organizationId,
      is_deleted: 0,
    })
    .get();

  return !existingDoc.data || existingDoc.data.length === 0;
};

const findUniquePrefix = async (
  prefixData,
  organizationId,
  collection = "packing",
  prefix = "packing_no"
) => {
  const now = new Date();
  let prefixToShow;
  let runningNumber = prefixData.running_number || 1;
  let isUnique = false;
  let maxAttempts = 10;
  let attempts = 0;

  while (!isUnique && attempts < maxAttempts) {
    attempts++;
    prefixToShow = generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(
      prefixToShow,
      organizationId,
      collection,
      prefix
    );
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    throw new Error(
      "Could not generate a unique Packing number after maximum attempts"
    );
  }

  return { prefixToShow, runningNumber };
};

const checkHUUniqueness = async (huNo, organizationId, plantId) => {
  try {
    // Only check in packing_line collection (single source of truth)
    const existingInPackingLine = await db
      .collection("packing_line")
      .where({
        hu_no: huNo,
        organization_id: organizationId,
        plant_id: plantId,
        is_deleted: 0,
      })
      .get();

    return (
      !existingInPackingLine.data || existingInPackingLine.data.length === 0
    );
  } catch (error) {
    console.error("Error checking HU uniqueness:", error);
    throw error;
  }
};

const getMaxHUNumber = async (organizationId, plantId) => {
  try {
    let maxNumber = 0;

    // Only check packing_line collection (single source of truth)
    const packingLines = await db
      .collection("packing_line")
      .where({
        organization_id: organizationId,
        plant_id: plantId,
        is_deleted: 0,
      })
      .get();

    if (packingLines.data && packingLines.data.length > 0) {
      packingLines.data.forEach((line) => {
        if (line.hu_no && line.hu_no.startsWith("HU-")) {
          const num = parseInt(line.hu_no.replace("HU-", ""));
          if (!isNaN(num) && num > maxNumber) {
            maxNumber = num;
          }
        }
      });
    }

    return maxNumber;
  } catch (error) {
    console.error("Error getting max HU number:", error);
    throw error;
  }
};

const generateHUNumbers = async (organizationId, plantId, tableHU) => {
  try {
    if (!tableHU || tableHU.length === 0) {
      return tableHU;
    }

    // First, validate uniqueness of manually entered HU numbers
    const manualHUNumbers = tableHU
      .filter((hu) => hu.hu_no && hu.hu_no !== "Auto-generated")
      .map((hu) => hu.hu_no);

    // Check for duplicates within the current table_hu
    const duplicatesInTable = manualHUNumbers.filter(
      (hu, index) => manualHUNumbers.indexOf(hu) !== index
    );

    if (duplicatesInTable.length > 0) {
      throw new Error(
        `Duplicate HU numbers found in table: ${duplicatesInTable.join(", ")}`
      );
    }

    // Check uniqueness against existing records
    for (const huNo of manualHUNumbers) {
      const isUnique = await checkHUUniqueness(huNo, organizationId, plantId);
      if (!isUnique) {
        throw new Error(
          `HU Number "${huNo}" already exists. Please use a different number.`
        );
      }
    }

    // Count how many HU numbers need to be generated
    const autoGeneratedCount = tableHU.filter(
      (hu) => hu.hu_no === "Auto-generated" || !hu.hu_no
    ).length;

    if (autoGeneratedCount === 0) {
      return tableHU;
    }

    // Get prefix configuration for Handling Unit
    const prefixData = await getPrefixData(organizationId, "Handling Unit");

    let currentRunningNumber;
    const generatedNumbers = [];

    if (prefixData && prefixData.is_active === 1) {
      // Use prefix configuration
      currentRunningNumber = prefixData.running_number || 1;
      const now = new Date();

      for (let i = 0; i < autoGeneratedCount; i++) {
        const huNumber = generatePrefix(
          currentRunningNumber + i,
          now,
          prefixData
        );
        generatedNumbers.push(huNumber);
      }

      // Update the running number in prefix configuration
      await updatePrefix(
        organizationId,
        currentRunningNumber + autoGeneratedCount - 1,
        "Handling Unit"
      );
    } else {
      // Fallback: manual generation without prefix config
      // Find the highest existing HU number from both collections
      const maxNumber = await getMaxHUNumber(organizationId, plantId);
      currentRunningNumber = maxNumber + 1;

      for (let i = 0; i < autoGeneratedCount; i++) {
        const huNumber = `HU-${String(currentRunningNumber + i).padStart(
          4,
          "0"
        )}`;
        generatedNumbers.push(huNumber);
      }
    }

    // Assign generated numbers to table_hu items
    let generatedIndex = 0;
    const updatedTableHU = tableHU.map((hu) => {
      if (hu.hu_no === "Auto-generated" || !hu.hu_no) {
        return {
          ...hu,
          hu_no: generatedNumbers[generatedIndex++],
        };
      }
      return hu;
    });

    console.log("Generated HU numbers:", generatedNumbers);
    return updatedTableHU;
  } catch (error) {
    console.error("Error generating HU numbers:", error);
    throw error;
  }
};

const validateForm = (data, requiredFields) => {
  const missingFields = [];

  requiredFields.forEach((field) => {
    const value = data[field.name];

    // Handle non-array fields (unchanged)
    if (!field.isArray) {
      if (validateField(value)) {
        missingFields.push(field.label);
      }
      return;
    }

    // Handle array fields
    if (!Array.isArray(value)) {
      missingFields.push(`${field.label}`);
      return;
    }

    if (value.length === 0) {
      missingFields.push(`${field.label}`);
      return;
    }

    // Check each item in the array
    if (field.arrayType === "object" && field.arrayFields && value.length > 0) {
      value.forEach((item, index) => {
        field.arrayFields.forEach((subField) => {
          const subValue = item[subField.name];
          if (validateField(subValue)) {
            missingFields.push(
              `${subField.label} (in ${field.label} #${index + 1})`
            );
          }
        });
      });
    }
  });

  return missingFields;
};

const validateField = (value) => {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return value <= 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return !value;
};

// Helper function to safely parse JSON
const _parseJsonSafely = (jsonString, defaultValue = []) => {
  try {
    return jsonString ? JSON.parse(jsonString) : defaultValue;
  } catch (error) {
    console.error("JSON parse error:", error);
    return defaultValue;
  }
};

// For quantities - 3 decimal places
const roundQty = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(3));
};

// For prices - 4 decimal places
const roundPrice = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(4));
};

// Function to get FIFO cost price
const getFIFOCostPrice = async (
  materialId,
  deductionQty,
  plantId,
  organizationId,
  batchId = null
) => {
  try {
    const query = batchId
      ? db.collection("fifo_costing_history").where({
          material_id: materialId,
          batch_id: batchId,
          plant_id: plantId,
        })
      : db
          .collection("fifo_costing_history")
          .where({ material_id: materialId, plant_id: plantId });

    const response = await query.get();
    const result = response.data;

    if (result && Array.isArray(result) && result.length > 0) {
      const sortedRecords = result.sort(
        (a, b) => a.fifo_sequence - b.fifo_sequence
      );

      if (!deductionQty) {
        for (const record of sortedRecords) {
          const availableQty = roundQty(record.fifo_available_quantity || 0);
          if (availableQty > 0) {
            return roundPrice(record.fifo_cost_price || 0);
          }
        }
        return roundPrice(
          sortedRecords[sortedRecords.length - 1].fifo_cost_price || 0
        );
      }

      let remainingQtyToDeduct = roundQty(deductionQty);
      let totalCost = 0;
      let totalDeductedQty = 0;

      for (const record of sortedRecords) {
        if (remainingQtyToDeduct <= 0) break;

        const availableQty = roundQty(record.fifo_available_quantity || 0);
        if (availableQty <= 0) continue;

        const costPrice = roundPrice(record.fifo_cost_price || 0);
        const qtyToDeduct = Math.min(availableQty, remainingQtyToDeduct);
        const costContribution = roundPrice(qtyToDeduct * costPrice);

        totalCost = roundPrice(totalCost + costContribution);
        totalDeductedQty = roundQty(totalDeductedQty + qtyToDeduct);
        remainingQtyToDeduct = roundQty(remainingQtyToDeduct - qtyToDeduct);
      }

      if (remainingQtyToDeduct > 0 && sortedRecords.length > 0) {
        const lastRecord = sortedRecords[sortedRecords.length - 1];
        const lastCostPrice = roundPrice(lastRecord.fifo_cost_price || 0);
        const additionalCost = roundPrice(remainingQtyToDeduct * lastCostPrice);
        totalCost = roundPrice(totalCost + additionalCost);
        totalDeductedQty = roundQty(totalDeductedQty + remainingQtyToDeduct);
      }

      if (totalDeductedQty > 0) {
        return roundPrice(totalCost / totalDeductedQty);
      }

      return roundPrice(sortedRecords[0].fifo_cost_price || 0);
    }

    return 0;
  } catch (error) {
    console.error(`Error retrieving FIFO cost price for ${materialId}:`, error);
    return 0;
  }
};

// Function to get Weighted Average cost price
const getWeightedAverageCostPrice = async (
  materialId,
  plantId,
  organizationId
) => {
  try {
    const query = db.collection("wa_costing_method").where({
      material_id: materialId,
      plant_id: plantId,
      organization_id: organizationId,
    });

    const response = await query.get();
    const waData = response.data;

    if (waData && Array.isArray(waData) && waData.length > 0) {
      waData.sort((a, b) => {
        if (a.created_at && b.created_at) {
          return new Date(b.created_at) - new Date(a.created_at);
        }
        return 0;
      });

      return roundPrice(waData[0].wa_cost_price || 0);
    }

    return 0;
  } catch (error) {
    console.error(`Error retrieving WA cost price for ${materialId}:`, error);
    return 0;
  }
};

// Function to get Fixed Cost price
const getFixedCostPrice = async (materialId) => {
  try {
    const query = db.collection("Item").where({ id: materialId });
    const response = await query.get();
    const result = response.data;

    if (result && result.length > 0) {
      return roundPrice(parseFloat(result[0].purchase_unit_price || 0));
    }

    return 0;
  } catch (error) {
    console.error(
      `Error retrieving fixed cost price for ${materialId}:`,
      error
    );
    return 0;
  }
};

// Helper: Sort function with date fallbacks (cached for performance)
const sortByDateWithFallbacks = (items, dateFields) => {
  // Pre-parse dates for performance
  const itemsWithParsedDates = items.map((item) => ({
    ...item,
    _parsedDates: dateFields.map((field) =>
      item[field] ? new Date(item[field]).getTime() : null
    ),
  }));

  itemsWithParsedDates.sort((a, b) => {
    for (let i = 0; i < dateFields.length; i++) {
      const aDate = a._parsedDates[i];
      const bDate = b._parsedDates[i];

      if (aDate && bDate) {
        return aDate - bDate;
      }
      if (aDate) return -1; // a has date, b doesn't - a comes first
      if (bDate) return 1; // b has date, a doesn't - b comes first
    }
    return 0;
  });

  // Remove temporary parsed dates
  return itemsWithParsedDates.map(({ _parsedDates, ...item }) => item);
};

// Helper: Allocate quantity across balance records (FEFO/FIFO)
const allocateQuantity = (balanceData, requiredQty, isoBatch) => {
  let remainingQty = requiredQty;
  const allocations = [];

  for (const balance of balanceData) {
    if (remainingQty <= 0) break;

    const availableQty = parseFloat(balance.unrestricted_qty) || 0;

    if (availableQty <= 0) {
      continue; // Skip records with no unrestricted quantity
    }

    // Take what we can from this record
    const qtyToTake = Math.min(remainingQty, availableQty);

    if (isoBatch) {
      allocations.push({
        batchId: balance.batch_id,
        batchNo: balance.batch_no,
        locationId: balance.location_id,
        quantity: qtyToTake,
        expiredDate: balance.expired_date,
      });
    } else {
      allocations.push({
        locationId: balance.location_id,
        quantity: qtyToTake,
        createTime: balance.create_time,
      });
    }

    remainingQty -= qtyToTake;
  }

  return { allocations, remainingQty };
};

// Helper: Calculate costing price
const calculateCostingPrice = async (
  costingMethod,
  materialId,
  quantity,
  plantId,
  organizationId,
  batchId = null
) => {
  let unitPrice = 0;

  if (costingMethod === "FIFO") {
    const fifoCostPrice = await getFIFOCostPrice(
      materialId,
      quantity,
      plantId,
      organizationId,
      batchId
    );
    unitPrice = roundPrice(fifoCostPrice);
  } else if (costingMethod === "Weighted Average") {
    const waCostPrice = await getWeightedAverageCostPrice(
      materialId,
      plantId,
      organizationId
    );
    unitPrice = roundPrice(waCostPrice);
  } else if (costingMethod === "Fixed Cost") {
    const fixedCostPrice = await getFixedCostPrice(materialId);
    unitPrice = roundPrice(fixedCostPrice);
  }

  const totalPrice = roundPrice(unitPrice * quantity);
  return { unitPrice, totalPrice };
};

// Helper: Create inventory movement record
const createInventoryMovement = async (packingData, movementData) => {
  await db.collection("inventory_movement").add({
    transaction_type: "PKG",
    trx_no: packingData.packing_no,
    parent_trx_no:
      packingData.gd_no !== "" ? packingData.gd_no : packingData.so_no,
    ...movementData,
    movement: "OUT",
    inventory_category: "Unrestricted",
    is_deleted: 0,
  });
};

// Helper: Deduct from item_batch_balance
const deductBatchBalance = async (
  materialId,
  plantId,
  organizationId,
  batchId,
  locationId,
  quantity
) => {
  try {
    // Find the specific batch balance record
    const batchBalanceResult = await db
      .collection("item_batch_balance")
      .where({
        material_id: materialId,
        plant_id: plantId,
        organization_id: organizationId,
        batch_id: batchId,
        location_id: locationId,
        is_deleted: 0,
      })
      .get();

    if (!batchBalanceResult.data || batchBalanceResult.data.length === 0) {
      console.warn(
        `Batch balance not found for material ${materialId}, batch ${batchId}, location ${locationId}`
      );
      return;
    }

    const batchBalance = batchBalanceResult.data[0];
    const currentUnrestricted = parseFloat(batchBalance.unrestricted_qty) || 0;
    const currentBalance = parseFloat(batchBalance.balance_quantity) || 0;
    const newUnrestricted = currentUnrestricted - quantity;
    const newBalance = currentBalance - quantity;

    // Update item_batch_balance
    await db
      .collection("item_batch_balance")
      .doc(batchBalance.id)
      .update({
        unrestricted_qty: newUnrestricted,
        balance_quantity: newBalance,
      });

    console.log(
      `Deducted ${quantity} from batch ${batchId} at location ${locationId}. Unrestricted: ${currentUnrestricted} → ${newUnrestricted}, Balance: ${currentBalance} → ${newBalance}`
    );

    // Also update aggregated item_balance
    await updateAggregatedItemBalance(
      materialId,
      plantId,
      organizationId,
      locationId
    );
  } catch (error) {
    console.error(
      `Error deducting batch balance for ${materialId}:`,
      error
    );
    throw error;
  }
};

// Helper: Update aggregated item_balance from item_batch_balance
const updateAggregatedItemBalance = async (
  materialId,
  plantId,
  organizationId,
  locationId
) => {
  try {
    // Sum all batch balances for this material/plant/location
    const batchBalances = await db
      .collection("item_batch_balance")
      .where({
        material_id: materialId,
        plant_id: plantId,
        organization_id: organizationId,
        location_id: locationId,
        is_deleted: 0,
      })
      .get();

    let totalUnrestricted = 0;
    let totalReserved = 0;
    let totalInTransit = 0;
    let totalQualityInspection = 0;
    let totalBlocked = 0;
    let totalBalance = 0;

    if (batchBalances.data && batchBalances.data.length > 0) {
      batchBalances.data.forEach((batch) => {
        totalUnrestricted += parseFloat(batch.unrestricted_qty) || 0;
        totalReserved += parseFloat(batch.reserved_qty) || 0;
        totalInTransit += parseFloat(batch.in_transit_qty) || 0;
        totalQualityInspection += parseFloat(batch.quality_inspection_qty) || 0;
        totalBlocked += parseFloat(batch.blocked_qty) || 0;
        totalBalance += parseFloat(batch.balance_quantity) || 0;
      });
    }

    // Find or create item_balance record
    const itemBalanceResult = await db
      .collection("item_balance")
      .where({
        material_id: materialId,
        plant_id: plantId,
        organization_id: organizationId,
        location_id: locationId,
        is_deleted: 0,
      })
      .get();

    if (itemBalanceResult.data && itemBalanceResult.data.length > 0) {
      // Update existing record
      await db
        .collection("item_balance")
        .doc(itemBalanceResult.data[0].id)
        .update({
          unrestricted_qty: totalUnrestricted,
          reserved_qty: totalReserved,
          in_transit_qty: totalInTransit,
          quality_inspection_qty: totalQualityInspection,
          blocked_qty: totalBlocked,
          balance_quantity: totalBalance,
        });

      console.log(
        `Updated aggregated item_balance for ${materialId} at location ${locationId}. Unrestricted: ${totalUnrestricted}, Balance: ${totalBalance}`
      );
    } else {
      console.warn(
        `Item balance not found for ${materialId} at location ${locationId}, skipping aggregation update`
      );
    }
  } catch (error) {
    console.error(
      `Error updating aggregated item_balance for ${materialId}:`,
      error
    );
    throw error;
  }
};

// Helper: Deduct from item_balance (non-batch items)
const deductItemBalance = async (
  materialId,
  plantId,
  organizationId,
  locationId,
  quantity
) => {
  try {
    // Find the specific item balance record
    const itemBalanceResult = await db
      .collection("item_balance")
      .where({
        material_id: materialId,
        plant_id: plantId,
        organization_id: organizationId,
        location_id: locationId,
        is_deleted: 0,
      })
      .get();

    if (!itemBalanceResult.data || itemBalanceResult.data.length === 0) {
      console.warn(
        `Item balance not found for material ${materialId} at location ${locationId}`
      );
      return;
    }

    const itemBalance = itemBalanceResult.data[0];
    const currentUnrestricted = parseFloat(itemBalance.unrestricted_qty) || 0;
    const currentBalance = parseFloat(itemBalance.balance_quantity) || 0;
    const newUnrestricted = currentUnrestricted - quantity;
    const newBalance = currentBalance - quantity;

    // Update item_balance
    await db
      .collection("item_balance")
      .doc(itemBalance.id)
      .update({
        unrestricted_qty: newUnrestricted,
        balance_quantity: newBalance,
      });

    console.log(
      `Deducted ${quantity} from item_balance at location ${locationId}. Unrestricted: ${currentUnrestricted} → ${newUnrestricted}, Balance: ${currentBalance} → ${newBalance}`
    );
  } catch (error) {
    console.error(
      `Error deducting item_balance for ${materialId}:`,
      error
    );
    throw error;
  }
};

// Helper: Update FIFO costing history (optimized with async/await)
const updateFIFOInventory = async (
  materialId,
  quantity,
  batchId,
  plantId,
  organizationId
) => {
  try {
    const whereClause = {
      material_id: materialId,
      plant_id: plantId,
      organization_id: organizationId,
    };

    if (batchId) {
      whereClause.batch_id = batchId;
    }

    const response = await db
      .collection("fifo_costing_history")
      .where(whereClause)
      .get();

    if (!response.data || response.data.length === 0) {
      console.warn(`No FIFO records found for material ${materialId}`);
      return;
    }

    // Sort by FIFO sequence (oldest first)
    const sortedRecords = response.data.sort(
      (a, b) => (a.fifo_sequence || 0) - (b.fifo_sequence || 0)
    );

    let remainingQty = roundQty(quantity);
    console.log(`Deducting ${remainingQty} units from FIFO for ${materialId}`);

    // Deduct from each FIFO record in sequence
    for (const record of sortedRecords) {
      if (remainingQty <= 0) break;

      const availableQty = roundQty(record.fifo_available_quantity || 0);
      if (availableQty <= 0) continue;

      const qtyToDeduct = Math.min(remainingQty, availableQty);
      const newAvailableQty = roundQty(availableQty - qtyToDeduct);

      // Update FIFO record
      await db
        .collection("fifo_costing_history")
        .doc(record.id)
        .update({
          fifo_available_quantity: newAvailableQty,
        });

      console.log(
        `FIFO seq ${record.fifo_sequence}: ${availableQty} → ${newAvailableQty}`
      );

      remainingQty = roundQty(remainingQty - qtyToDeduct);
    }

    if (remainingQty > 0) {
      console.warn(
        `Warning: FIFO shortfall for ${materialId}. Remaining: ${remainingQty}`
      );
    }
  } catch (error) {
    console.error(`Error updating FIFO for ${materialId}:`, error);
    throw error;
  }
};

// Helper: Update Weighted Average costing (optimized with async/await)
const updateWeightedAverage = async (
  materialId,
  quantity,
  batchId,
  plantId,
  organizationId
) => {
  try {
    // Input validation
    if (!materialId || isNaN(parseFloat(quantity)) || parseFloat(quantity) <= 0) {
      console.error("Invalid data for weighted average update:", materialId);
      return;
    }

    const whereClause = {
      material_id: materialId,
      plant_id: plantId,
      organization_id: organizationId,
    };

    if (batchId) {
      whereClause.batch_id = batchId;
    }

    const waResponse = await db
      .collection("wa_costing_method")
      .where(whereClause)
      .get();

    if (!waResponse.data || waResponse.data.length === 0) {
      console.warn(`No weighted average records found for material ${materialId}`);
      return;
    }

    // Sort by date (newest first) to get the latest record
    const waData = waResponse.data.sort((a, b) => {
      if (a.created_at && b.created_at) {
        return new Date(b.created_at) - new Date(a.created_at);
      }
      return 0;
    });

    const waDoc = waData[0];
    const waCostPrice = roundPrice(waDoc.wa_cost_price || 0);
    const waQuantity = roundQty(waDoc.wa_quantity || 0);

    if (waQuantity <= 0) {
      console.warn(`WA quantity already zero for ${materialId}`);
      return;
    }

    const qtyToDeduct = roundQty(quantity);
    const newWaQuantity = Math.max(0, roundQty(waQuantity - qtyToDeduct));

    // Update WA record
    await db
      .collection("wa_costing_method")
      .doc(waDoc.id)
      .update({
        wa_quantity: newWaQuantity,
        wa_cost_price: waCostPrice,
        updated_at: new Date(),
      });

    console.log(
      `WA for ${materialId}: ${waQuantity} → ${newWaQuantity} (cost: ${waCostPrice})`
    );

    if (waQuantity < qtyToDeduct) {
      console.warn(
        `WA shortfall for ${materialId}. Available: ${waQuantity}, Requested: ${qtyToDeduct}`
      );
    }
  } catch (error) {
    console.error(`Error updating WA for ${materialId}:`, error);
    throw error;
  }
};

const processHUBalance = async (packingData) => {
  try {
    // Input validation
    if (!packingData || !packingData.table_hu) {
      console.log("No table_hu data to process");
      return;
    }

    const tableHU = packingData.table_hu;
    const packingMode = packingData.packing_mode;

    if (!tableHU || tableHU.length === 0) {
      console.log("table_hu is empty, skipping processHUBalance");
      return;
    }

    if (packingMode === "Basic") {
      // Step 1: Batch fetch all Item data to avoid N+1 queries
      const uniqueMaterialIds = [
        ...new Set(tableHU.map((hu) => hu.material_id).filter(Boolean)),
      ];

      if (uniqueMaterialIds.length === 0) {
        console.log("No material IDs found in table_hu");
        return;
      }

      const itemsResult = await db
        .collection("Item")
        .where({
          id: db.command.in(uniqueMaterialIds),
        })
        .get();

      // Create a map for O(1) lookup
      const itemsMap = new Map();
      if (itemsResult.data && itemsResult.data.length > 0) {
        itemsResult.data.forEach((item) => {
          itemsMap.set(item.id, item);
        });
      }

      // Step 2: Process each HU item
      for (const [_index, huItem] of tableHU.entries()) {
        const materialId = huItem.material_id;
        const quantity = huItem.hu_quantity;
        const plantId = huItem.plant_id;
        const organizationId = huItem.organization_id;

        // Get item details from map (O(1) lookup)
        const itemData = itemsMap.get(materialId);

        if (!itemData) {
          console.log(`Item ${materialId} not found, skipping`);
          continue;
        }

        const baseUOM = itemData.based_uom;
        const costingMethod = itemData.item_costing_method;
        const isBatch = itemData.item_batch_management;

        // Step 3: Handle batch vs non-batch items
        if (isBatch) {
          // Fetch batch balance data
          const itemBatchBalanceData = await db
            .collection("item_batch_balance")
            .where({
              material_id: materialId,
              plant_id: plantId,
              organization_id: organizationId,
            })
            .get()
            .then((res) => res.data || []);

          if (itemBatchBalanceData.length === 0) {
            console.log(`Item batch balance ${materialId} not found, skipping`);
            continue;
          }

          // Sort using helper (FEFO with fallbacks)
          const sortedBatchData = sortByDateWithFallbacks(
            itemBatchBalanceData,
            ["expired_date", "manufacturing_date", "create_time"]
          );

          // Allocate quantity using helper
          const { allocations, remainingQty } = allocateQuantity(
            sortedBatchData,
            quantity,
            true // isBatch = true
          );

          // Check if we have enough total quantity
          if (remainingQty > 0) {
            throw new Error(
              `Insufficient batch quantity for item ${materialId}. Required: ${quantity}, Available: ${
                quantity - remainingQty
              }`
            );
          }

          // Create inventory movements and deduct balances for each batch allocation
          for (const allocation of allocations) {
            const { unitPrice, totalPrice } = await calculateCostingPrice(
              costingMethod,
              materialId,
              allocation.quantity,
              plantId,
              organizationId,
              allocation.batchId
            );

            // Create inventory movement
            await createInventoryMovement(packingData, {
              unit_price: unitPrice,
              total_price: totalPrice,
              quantity: allocation.quantity,
              item_id: materialId,
              uom_id: baseUOM,
              base_qty: allocation.quantity,
              base_uom_id: baseUOM,
              batch_number_id: allocation.batchId,
              costing_method_id: costingMethod,
              plant_id: plantId,
              organization_id: organizationId,
              bin_location_id: allocation.locationId,
            });

            // Deduct from item_batch_balance (also updates aggregated item_balance)
            await deductBatchBalance(
              materialId,
              plantId,
              organizationId,
              allocation.batchId,
              allocation.locationId,
              allocation.quantity
            );

            // Update FIFO/WA costing based on costing method
            if (costingMethod === "FIFO") {
              await updateFIFOInventory(
                materialId,
                allocation.quantity,
                allocation.batchId,
                plantId,
                organizationId
              );
            } else if (costingMethod === "Weighted Average") {
              await updateWeightedAverage(
                materialId,
                allocation.quantity,
                allocation.batchId,
                plantId,
                organizationId
              );
            }

            console.log(
              `Created OUT movement for batch ${allocation.batchNo} at location ${allocation.locationId}: ${allocation.quantity} units`
            );
          }
        } else {
          // Non-batch item - fetch item_balance
          const itemBalanceData = await db
            .collection("item_balance")
            .where({
              material_id: materialId,
              plant_id: plantId,
              organization_id: organizationId,
            })
            .get()
            .then((res) => res.data || []);

          if (itemBalanceData.length === 0) {
            console.log(`Item balance ${materialId} not found, skipping`);
            continue;
          }

          // Sort using helper (FIFO by create_time)
          const sortedBalanceData = sortByDateWithFallbacks(itemBalanceData, [
            "create_time",
          ]);

          // Allocate quantity using helper
          const { allocations, remainingQty } = allocateQuantity(
            sortedBalanceData,
            quantity,
            false // isBatch = false
          );

          // Check if we have enough total quantity
          if (remainingQty > 0) {
            throw new Error(
              `Insufficient item balance for item ${materialId}. Required: ${quantity}, Available: ${
                quantity - remainingQty
              }`
            );
          }

          // Create inventory movements and deduct balances for each location allocation
          for (const allocation of allocations) {
            const { unitPrice, totalPrice } = await calculateCostingPrice(
              costingMethod,
              materialId,
              allocation.quantity,
              plantId,
              organizationId,
              null // No batch for non-batch items
            );

            // Create inventory movement
            await createInventoryMovement(packingData, {
              unit_price: unitPrice,
              total_price: totalPrice,
              quantity: allocation.quantity,
              item_id: materialId,
              uom_id: baseUOM,
              base_qty: allocation.quantity,
              base_uom_id: baseUOM,
              batch_number_id: null,
              costing_method_id: costingMethod,
              plant_id: plantId,
              organization_id: organizationId,
              bin_location_id: allocation.locationId,
            });

            // Deduct from item_balance
            await deductItemBalance(
              materialId,
              plantId,
              organizationId,
              allocation.locationId,
              allocation.quantity
            );

            // Update FIFO/WA costing based on costing method
            if (costingMethod === "FIFO") {
              await updateFIFOInventory(
                materialId,
                allocation.quantity,
                null, // No batch for non-batch items
                plantId,
                organizationId
              );
            } else if (costingMethod === "Weighted Average") {
              await updateWeightedAverage(
                materialId,
                allocation.quantity,
                null, // No batch for non-batch items
                plantId,
                organizationId
              );
            }

            console.log(
              `Created OUT movement for non-batch item ${materialId} at location ${allocation.locationId}: ${allocation.quantity} units`
            );
          }
        }
      }
    }
  } catch (error) {
    console.error("Error processing HU balance:", error);
    throw error;
  }
};

const addEntry = async (organizationId, packingData) => {
  try {
    const prefixData = await getPrefixData(organizationId, "Packing");

    if (prefixData) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId,
        "packing",
        "packing_no"
      );

      await updatePrefix(organizationId, runningNumber, "Packing");
      packingData.packing_no = prefixToShow;
    } else {
      const isUnique = await checkUniqueness(
        packingData.packing_no,
        organizationId,
        "packing",
        "packing_no"
      );
      if (!isUnique) {
        throw new Error(
          `Packing Number "${packingData.packing_no}" already exists. Please use a different number.`
        );
      }
    }

    await processHUBalance(packingData);

    // Add the record
    const createdRecord = await db.collection("packing").add(packingData);

    if (!createdRecord.data || createdRecord.data.length === 0) {
      throw new Error("Failed to retrieve created packing record");
    }

    const packingId = createdRecord.data[0].id;
    console.log("Packing created successfully with ID:", packingId);
  } catch (error) {
    console.error("Error in addEntry:", error);
    throw error;
  }
};

const fillbackHeaderFields = async (packingData) => {
  try {
    if (!packingData.table_hu || packingData.table_hu.length === 0) {
      return packingData.table_hu || [];
    }

    for (const [_index, packingLineItem] of packingData.table_hu.entries()) {
      packingLineItem.customer_id = packingData.customer_id || null;
      packingLineItem.organization_id = packingData.organization_id || null;
      packingLineItem.plant_id = packingData.plant_id || null;
    }
    return packingData.table_hu;
  } catch (error) {
    console.error("Error in fillbackHeaderFields:", error);
    throw error;
  }
};

const updateEntry = async (
  organizationId,
  packingData,
  packingId,
  originalPackingStatus
) => {
  try {
    if (originalPackingStatus === "Draft") {
      const prefixData = await getPrefixData(organizationId, "Packing");

      if (prefixData) {
        const { prefixToShow, runningNumber } = await findUniquePrefix(
          prefixData,
          organizationId,
          "packing",
          "packing_no"
        );

        await updatePrefix(organizationId, runningNumber, "Packing");
        packingData.packing_no = prefixToShow;
      } else {
        const isUnique = await checkUniqueness(
          packingData.packing_no,
          organizationId,
          "packing",
          "packing_no"
        );
        if (!isUnique) {
          throw new Error(
            `Packing Number "${packingData.packing_no}" already exists. Please use a different number.`
          );
        }
      }
    }

    await processHUBalance(packingData);

    await db.collection("packing").doc(packingId).update(packingData);

    console.log("Packing updated successfully");
    return packingId;
  } catch (error) {
    console.error("Error in updateEntry:", error);
    throw error;
  }
};

const findFieldMessage = (obj) => {
  // Base case: if current object has the structure we want
  if (obj && typeof obj === "object") {
    if (obj.field && obj.message) {
      return obj.message;
    }

    // Check array elements
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findFieldMessage(item);
        if (found) return found;
      }
    }

    // Check all object properties
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const found = findFieldMessage(obj[key]);
        if (found) return found;
      }
    }
  }
  return null;
};

const headerCalculation = (data) => {
  const packingMode = data.packing_mode;
  const tableHU = data.table_hu || [];
  const tableItems = data.table_items || [];

  // Calculate total item quantity (with safety checks)
  data.total_item_qty = tableItems.reduce(
    (total, item) => total + (parseFloat(item.quantity) || 0),
    0
  );

  // Calculate total HU count based on packing mode
  if (packingMode === "Basic") {
    data.total_hu_count = tableHU.reduce(
      (total, item) => total + (parseInt(item.hu_quantity) || 0),
      0
    );
  } else {
    data.total_hu_count = tableHU.length;
  }

  // Count unique item codes (efficient approach)
  data.total_item_count = new Set(
    tableItems.map((item) => item.item_code).filter(Boolean)
  ).size;

  return data;
};

const updateSOStatus = async (data) => {
  try {
    const tableItems = data.table_items || [];
    const packingMode = data.packing_mode;

    if (packingMode === "Basic") {
      //filter duplicated so_id
      const uniqueSOIds = [...new Set(tableItems.map((item) => item.so_id))];

      //filter duplicated so_line_id
      const uniqueSOLineIds = [
        ...new Set(tableItems.map((item) => item.so_line_id)),
      ];

      //update so status
      for (const soId of uniqueSOIds) {
        await db.collection("sales_order_axszx8cj_sub").doc(soId).update({
          packing_status: "Completed",
        });
      }

      //update so_line status
      for (const soLineId of uniqueSOLineIds) {
        await db.collection("sales_order_line").doc(soLineId).update({
          packing_status: "Completed",
        });
      }
    }
  } catch (error) {
    console.error("Error updating SO status:", error);
    throw error;
  }
};

const updateGDStatus = async (data) => {
  try {
    const tableItems = data.table_items || [];
    const packingMode = data.packing_mode;

    if (packingMode === "Basic") {
      //filter duplicated gd_id
      const uniqueGDIds = [...new Set(tableItems.map((item) => item.gd_id))];

      //filter duplicated gd_line_id
      const uniqueGDLineIds = [
        ...new Set(tableItems.map((item) => item.gd_line_id)),
      ];

      //update gd status
      for (const gdId of uniqueGDIds) {
        await db.collection("good_delivery").doc(gdId).update({
          packing_status: "Completed",
        });
      }

      //update gd_line status
      for (const gdLineId of uniqueGDLineIds) {
        await db
          .collection("goods_delivery_fwii8mvb_sub")
          .doc(gdLineId)
          .update({
            packing_status: "Completed",
          });
      }
    }
  } catch (error) {
    console.error("Error updating GD status:", error);
    throw error;
  }
};

const updateTOStatus = async (data) => {
  try {
    const tableItems = data.table_items || [];
    const packingMode = data.packing_mode;

    if (packingMode === "Basic") {
      //filter duplicated to_id
      const uniqueTOIds = [...new Set(tableItems.map((item) => item.to_id))];

      //filter duplicated to_line_id
      const uniqueTOLineIds = [
        ...new Set(tableItems.map((item) => item.to_line_id)),
      ];

      //update to status
      for (const toId of uniqueTOIds) {
        await db.collection("picking_plan").doc(toId).update({
          packing_status: "Completed",
        });
      }

      //update to_line status
      for (const toLineId of uniqueTOLineIds) {
        await db.collection("picking_plan_fwii8mvb_sub").doc(toLineId).update({
          packing_status: "Completed",
        });
      }
    }
  } catch (error) {
    console.error("Error updating TO status:", error);
    throw error;
  }
};

// Main execution wrapped in an async IIFE
(async () => {
  try {
    this.showLoading();
    const data = this.getValues();
    const page_status = data.page_status;
    const originalPackingStatus = data.packing_status;

    console.log(
      `Page Status: ${page_status}, Original Packing Status: ${originalPackingStatus}`
    );

    // Define required fields
    const requiredFields = [
      { name: "plant_id", label: "Plant" },
      { name: "packing_no", label: "Packing No" },
      {
        name: "table_hu",
        label: "Handling Unit Table",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    // Validate form
    const missingFields = validateForm(data, requiredFields);

    if (missingFields.length > 0) {
      this.hideLoading();
      this.$message.error(`Validation errors: ${missingFields.join(", ")}`);
      return;
    }

    // Get organization ID
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    // Prepare packing object
    let packingData = {
      packing_status: "Completed",
      plant_id: data.plant_id,
      packing_no: data.packing_no,
      so_no: data.so_no,
      gd_no: data.gd_no,
      so_id: data.so_id,
      gd_id: data.gd_id,
      to_id: data.to_id,
      customer_id: data.customer_id,
      billing_address: data.billing_address,
      shipping_address: data.shipping_address,
      organization_id: organizationId,
      packing_mode: data.packing_mode,
      packing_location: data.packing_location,
      assigned_to: data.assigned_to,
      created_by: this.getVarGlobal("userId"),
      ref_doc: data.ref_doc,
      table_hu: data.table_hu,
      table_items: data.table_items,
      remarks: data.remarks,
    };

    // Add created_at only for new records
    if (page_status === "Add") {
      packingData.created_at =
        data.created_at || new Date().toISOString().split("T")[0];
    }

    // Generate HU numbers for "Auto-generated" entries
    if (packingData.table_hu && packingData.table_hu.length > 0) {
      packingData.table_hu = await generateHUNumbers(
        organizationId,
        packingData.plant_id,
        packingData.table_hu
      );
    }

    // Clean up undefined/null values
    Object.keys(packingData).forEach((key) => {
      if (packingData[key] === undefined || packingData[key] === null) {
        delete packingData[key];
      }
    });

    // Fill back header fields to HU line items
    await fillbackHeaderFields(packingData);

    // Calculate header totals after cleanup
    packingData = await headerCalculation(packingData);

    let packingId;

    // Perform action based on page status
    if (page_status === "Add") {
      await addEntry(organizationId, packingData);
    } else if (page_status === "Edit") {
      packingId = data.id;
      await updateEntry(
        organizationId,
        packingData,
        packingId,
        originalPackingStatus
      );
    }

    if (packingData.so_id && packingData.so_id !== "") {
      await updateSOStatus(packingData);
    }
    if (packingData.gd_id && packingData.gd_id !== "") {
      await updateGDStatus(packingData);
    }
    if (packingData.to_id && packingData.to_id !== "") {
      await updateTOStatus(packingData);
    }

    this.$message.success(
      `${page_status === "Add" ? "Added" : "Updated"} successfully`
    );

    this.hideLoading();
    closeDialog();
  } catch (error) {
    this.hideLoading();

    let errorMessage = "";
    if (error && typeof error === "object") {
      errorMessage = findFieldMessage(error) || "An error occurred";
    } else {
      errorMessage = error;
    }

    this.$message.error(errorMessage);
    console.error(errorMessage);
  }
})();
