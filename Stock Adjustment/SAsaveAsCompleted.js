// For quantities - 3 decimal places
const roundQty = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(3));
};

// For prices - 4 decimal places
const roundPrice = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(4));
};

const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const logTableState = async (collectionName, queryConditions, logMessage) => {
  try {
    let query = db.collection(collectionName);
    if (queryConditions) {
      query = query.where(queryConditions);
    }
    const response = await query.get();
    const data = Array.isArray(response?.data)
      ? response.data
      : response.data
      ? [response.data]
      : [];
    console.log(`${logMessage}:`, {
      collection: collectionName,
      count: data.length,
      records: data.map((record) => ({
        id: record.id,
        ...record,
      })),
    });
  } catch (error) {
    console.error(`Error logging state for ${collectionName}:`, error);
  }
};

// Function to get latest FIFO cost price with available quantity check
const getLatestFIFOCostPrice = async (
  materialId,
  batchId,
  deductionQty = null
) => {
  try {
    const query = batchId
      ? db
          .collection("fifo_costing_history")
          .where({ material_id: materialId, batch_id: batchId })
      : db
          .collection("fifo_costing_history")
          .where({ material_id: materialId });

    const response = await query.get();
    const result = response.data;

    if (result && Array.isArray(result) && result.length > 0) {
      // Sort by FIFO sequence (lowest/oldest first, as per FIFO principle)
      const sortedRecords = result.sort(
        (a, b) => a.fifo_sequence - b.fifo_sequence
      );

      // If no deduction quantity is provided, just return the cost price of the first record with available quantity
      if (!deductionQty) {
        // First look for records with available quantity
        for (const record of sortedRecords) {
          const availableQty = roundQty(record.fifo_available_quantity || 0);
          if (availableQty > 0) {
            console.log(
              `Found FIFO record with available quantity: Sequence ${record.fifo_sequence}, Cost price ${record.fifo_cost_price}`
            );
            return roundPrice(record.fifo_cost_price || 0);
          }
        }

        // If no records with available quantity, use the most recent record
        console.warn(
          `No FIFO records with available quantity found for ${materialId}, using most recent cost price`
        );
        return roundPrice(
          sortedRecords[sortedRecords.length - 1].fifo_cost_price || 0
        );
      }

      let remainingQtyToDeduct = roundQty(deductionQty);
      let totalCost = 0;
      let totalDeductedQty = 0;

      // Log the calculation process
      console.log(
        `Calculating weighted average FIFO cost for ${materialId}, deduction quantity: ${remainingQtyToDeduct}`
      );

      for (const record of sortedRecords) {
        if (remainingQtyToDeduct <= 0) {
          break;
        }

        const availableQty = roundQty(record.fifo_available_quantity || 0);
        if (availableQty <= 0) {
          continue;
        }

        const costPrice = roundPrice(record.fifo_cost_price || 0);
        const qtyToDeduct = Math.min(availableQty, remainingQtyToDeduct);

        const costContribution = roundPrice(qtyToDeduct * costPrice);
        totalCost = roundPrice(totalCost + costContribution);
        totalDeductedQty = roundQty(totalDeductedQty + qtyToDeduct);

        console.log(
          `FIFO record sequence ${record.fifo_sequence}: Deducting ${qtyToDeduct} units at ${costPrice} per unit = ${costContribution}`
        );

        remainingQtyToDeduct = roundQty(remainingQtyToDeduct - qtyToDeduct);
      }

      // Calculate the weighted average cost price
      if (totalDeductedQty > 0) {
        const weightedAvgCost = roundPrice(totalCost / totalDeductedQty);
        console.log(
          `✅ FIFO Weighted Average Cost: ${totalCost} / ${totalDeductedQty} = ${weightedAvgCost}`
        );
        return weightedAvgCost;
      }

      // Fallback to first record with cost if no quantity could be deducted
      return roundPrice(sortedRecords[0].fifo_cost_price || 0);
    }

    console.warn(`No FIFO records found for material ${materialId}`);
    return 0;
  } catch (error) {
    console.error(`Error retrieving FIFO cost price for ${materialId}:`, error);
    return 0;
  }
};

// Function to get Weighted Average cost price
const getWeightedAverageCostPrice = async (materialId, batchId) => {
  try {
    const query = batchId
      ? db
          .collection("wa_costing_method")
          .where({ material_id: materialId, batch_id: batchId })
      : db.collection("wa_costing_method").where({ material_id: materialId });

    const response = await query.get();
    const waData = response.data;

    if (waData && Array.isArray(waData) && waData.length > 0) {
      // Sort by date (newest first) to get the latest record
      waData.sort((a, b) => {
        if (a.created_at && b.created_at) {
          return new Date(b.created_at) - new Date(a.created_at);
        }
        return 0;
      });

      return Number(parseFloat(waData[0].wa_cost_price || 0).toFixed(4));
    }

    console.warn(
      `No weighted average records found for material ${materialId}`
    );
    return 0;
  } catch (error) {
    console.error(`Error retrieving WA cost price for ${materialId}:`, error);
    return 0;
  }
};

const getFixedCostPrice = async (materialId) => {
  const query = db.collection("Item").where({ id: materialId });
  const response = await query.get();
  const result = response.data;
  return Number(parseFloat(result[0].purchase_unit_price || 0).toFixed(4));
};

// Helper function to check if item is serialized
const isSerializedItem = (materialData) => {
  return materialData && materialData.serial_number_management === 1;
};

// Helper function to parse balance index for serial numbers
const parseBalanceIndexForSerials = (balanceIndexData) => {
  return balanceIndexData.filter(
    (balance) =>
      balance.serial_number &&
      balance.serial_number.trim() !== "" &&
      balance.sa_quantity > 0
  );
};

// Function to validate duplicate serial numbers, excessive quantities, and allocation conflicts
const validateDuplicateSerialNumbers = (allData) => {
  console.log(
    "Validating duplicate serial numbers and allocation conflicts across items"
  );

  const serialNumberMap = new Map(); // key: materialId|serialNumber|batchId|locationId|category, value: { count, totalQuantity, items }
  const nonSerializedMap = new Map(); // key: materialId|batchId|locationId|category, value: { totalQuantity, items }

  for (
    let itemIndex = 0;
    itemIndex < allData.stock_adjustment.length;
    itemIndex++
  ) {
    const item = allData.stock_adjustment[itemIndex];
    const balanceIndexData = JSON.parse(item.balance_index);

    for (const balance of balanceIndexData) {
      // Skip zero quantity entries
      if (!balance.sa_quantity || balance.sa_quantity <= 0) {
        continue;
      }

      // Check if this is a serialized balance
      const isSerializedBalance =
        balance.serial_number && balance.serial_number.trim() !== "";

      if (isSerializedBalance) {
        // Handle serialized items
        const key = `${item.material_id}|${balance.serial_number}|${
          balance.batch_id || "no-batch"
        }|${balance.location_id}|${balance.category || "Unrestricted"}`;

        if (!serialNumberMap.has(key)) {
          serialNumberMap.set(key, {
            count: 0,
            totalQuantity: 0,
            items: [],
          });
        }

        const entry = serialNumberMap.get(key);
        entry.count += 1;
        entry.totalQuantity += balance.sa_quantity;
        entry.items.push({
          itemIndex: itemIndex + 1,
          materialId: item.material_id,
          serialNumber: balance.serial_number,
          quantity: balance.sa_quantity,
          category: balance.category || "Unrestricted",
          locationId: balance.location_id,
          batchId: balance.batch_id,
          movementType: balance.movement_type,
        });

        serialNumberMap.set(key, entry);
      } else {
        // Handle non-serialized items
        const key = `${item.material_id}|${balance.batch_id || "no-batch"}|${
          balance.location_id
        }|${balance.category || "Unrestricted"}`;

        if (!nonSerializedMap.has(key)) {
          nonSerializedMap.set(key, {
            totalQuantity: 0,
            items: [],
          });
        }

        const entry = nonSerializedMap.get(key);
        entry.totalQuantity += balance.sa_quantity;
        entry.items.push({
          itemIndex: itemIndex + 1,
          materialId: item.material_id,
          quantity: balance.sa_quantity,
          category: balance.category || "Unrestricted",
          locationId: balance.location_id,
          batchId: balance.batch_id,
          movementType: balance.movement_type,
        });

        nonSerializedMap.set(key, entry);
      }
    }
  }

  const violations = [];

  // Check serialized item violations
  for (const [key, entry] of serialNumberMap.entries()) {
    const keyParts = key.split("|");
    const violation = {
      type: "serialized",
      materialId: keyParts[0],
      serialNumber: keyParts[1],
      batchId: keyParts[2] !== "no-batch" ? keyParts[2] : null,
      locationId: keyParts[3],
      category: keyParts[4],
      count: entry.count,
      totalQuantity: entry.totalQuantity,
      items: entry.items,
      issues: [],
    };

    // Check for duplicates (same serial used multiple times)
    if (entry.count > 1) {
      violation.issues.push(`Used ${entry.count} times across different items`);
    }

    // Check for excessive quantity (serialized items should typically be 1 unit each)
    if (entry.totalQuantity > 1) {
      violation.issues.push(
        `Total quantity ${entry.totalQuantity} exceeds 1 unit (typical for serialized items)`
      );
    }

    // Check for non-integer quantities (serialized items should be whole units)
    if (entry.totalQuantity !== Math.floor(entry.totalQuantity)) {
      violation.issues.push(
        `Non-integer quantity ${entry.totalQuantity} (serialized items should be whole units)`
      );
    }

    if (violation.issues.length > 0) {
      violations.push(violation);
    }
  }

  // Check non-serialized item violations
  for (const [key, entry] of nonSerializedMap.entries()) {
    const keyParts = key.split("|");

    // Group items by movement type to check for conflicts
    const inMovements = entry.items.filter(
      (item) => item.movementType === "In"
    );
    const outMovements = entry.items.filter(
      (item) => item.movementType === "Out"
    );

    if (inMovements.length > 0 && outMovements.length > 0) {
      // Both IN and OUT movements for the same location/batch/category across different items
      const violation = {
        type: "non-serialized",
        materialId: keyParts[0],
        batchId: keyParts[1] !== "no-batch" ? keyParts[1] : null,
        locationId: keyParts[2],
        category: keyParts[3],
        totalQuantity: entry.totalQuantity,
        items: entry.items,
        issues: [],
      };

      violation.issues.push(
        `Conflicting movements: ${inMovements.length} IN movement(s) and ${outMovements.length} OUT movement(s) for the same location/batch/category`
      );

      violations.push(violation);
    }
  }

  if (violations.length > 0) {
    console.error(
      "Inventory allocation validation violations found:",
      violations
    );

    // Build detailed error message
    let errorMessage = "Inventory allocation validation errors detected:\n\n";

    violations.forEach((violation, index) => {
      errorMessage += `${index + 1}. Material ID: ${violation.materialId}\n`;

      if (violation.type === "serialized") {
        errorMessage += `   Serial Number: "${violation.serialNumber}"\n`;
      }

      if (violation.batchId) {
        errorMessage += `   Batch: ${violation.batchId}\n`;
      }
      errorMessage += `   Location: ${violation.locationId}\n`;
      errorMessage += `   Category: ${violation.category}\n`;
      errorMessage += `   Issues:\n`;
      violation.issues.forEach((issue) => {
        errorMessage += `     • ${issue}\n`;
      });

      if (violation.type === "serialized") {
        errorMessage += `   Used in items: ${violation.items
          .map((item) => `#${item.itemIndex} (qty: ${item.quantity})`)
          .join(", ")}\n\n`;
      } else {
        errorMessage += `   Items involved:\n`;
        violation.items.forEach((item) => {
          errorMessage += `     - Item #${item.itemIndex}: ${item.movementType} ${item.quantity} units\n`;
        });
        errorMessage += `\n`;
      }
    });

    errorMessage += "Please ensure:\n";
    errorMessage +=
      "• Each serial number is used only once per material/location/batch/category\n";
    errorMessage +=
      "• Serialized items use whole number quantities (typically 1 unit per serial)\n";
    errorMessage +=
      "• No conflicting IN/OUT movements for the same non-serialized item location/batch/category\n";
    errorMessage +=
      "• No duplicate serial number selections across different items";

    throw new Error(errorMessage);
  }

  console.log("Inventory allocation validation passed - no conflicts found");
  return true;
};

// Function to update serial balance for serialized items
const updateSerialBalance = async (
  materialId,
  serialNumber,
  batchId,
  locationId,
  category,
  qtyChange,
  plantId,
  organizationId
) => {
  try {
    console.log(
      `Updating serial balance for ${serialNumber}: ${category} change ${qtyChange}`
    );

    const serialBalanceParams = {
      material_id: materialId,
      serial_number: serialNumber,
      plant_id: plantId,
      organization_id: organizationId,
      location_id: locationId,
    };

    if (batchId) {
      serialBalanceParams.batch_id = batchId;
    }

    if (locationId) {
      serialBalanceParams.location_id = locationId;
    }

    const serialBalanceQuery = await db
      .collection("item_serial_balance")
      .where(serialBalanceParams)
      .get();

    if (!serialBalanceQuery.data || serialBalanceQuery.data.length === 0) {
      throw new Error(
        `No serial balance found for serial number: ${serialNumber}`
      );
    }

    const existingBalance = serialBalanceQuery.data[0];
    const categoryMap = {
      Unrestricted: "unrestricted_qty",
      Reserved: "reserved_qty",
      "Quality Inspection": "qualityinsp_qty",
      Blocked: "block_qty",
    };

    const categoryField = categoryMap[category] || "unrestricted_qty";
    const currentCategoryQty = roundQty(
      parseFloat(existingBalance[categoryField] || 0)
    );
    const currentBalanceQty = roundQty(
      parseFloat(existingBalance.balance_quantity || 0)
    );

    const newCategoryQty = roundQty(currentCategoryQty + qtyChange);
    const newBalanceQty = roundQty(currentBalanceQty + qtyChange);

    if (newCategoryQty < 0) {
      throw new Error(
        `Insufficient ${category} quantity for serial ${serialNumber}. Available: ${currentCategoryQty}, Requested: ${Math.abs(
          qtyChange
        )}`
      );
    }

    if (newBalanceQty < 0) {
      throw new Error(
        `Insufficient total quantity for serial ${serialNumber}. Available: ${currentBalanceQty}, Requested: ${Math.abs(
          qtyChange
        )}`
      );
    }

    const updateData = {
      [categoryField]: newCategoryQty,
      balance_quantity: newBalanceQty,
      updated_at: new Date(),
    };

    await db
      .collection("item_serial_balance")
      .doc(existingBalance.id)
      .update(updateData);

    console.log(
      `Updated serial balance for ${serialNumber}: ${category}=${newCategoryQty}, Balance=${newBalanceQty}`
    );

    return true;
  } catch (error) {
    console.error(`Error updating serial balance for ${serialNumber}:`, error);
    throw error;
  }
};

// Function to create serial movement records
const createSerialMovementRecord = async (
  inventoryMovementId,
  serialNumber,
  batchId,
  baseQty,
  baseUOM,
  plantId,
  organizationId
) => {
  try {
    const invSerialMovementRecord = {
      inventory_movement_id: inventoryMovementId,
      serial_number: serialNumber,
      batch_id: batchId || null,
      base_qty: roundQty(baseQty),
      base_uom: baseUOM,
      plant_id: plantId,
      organization_id: organizationId,
      created_at: new Date(),
    };

    await db.collection("inv_serial_movement").add(invSerialMovementRecord);
    console.log(`Created inv_serial_movement for serial: ${serialNumber}`);

    return true;
  } catch (error) {
    console.error(
      `Error creating serial movement record for ${serialNumber}:`,
      error
    );
    throw error;
  }
};

// Main function to process serialized item adjustments
const processSerializedItemAdjustment = async (
  item,
  materialData,
  balanceIndexData,
  adjustment_type,
  plant_id,
  organization_id,
  allData
) => {
  console.log(
    `Processing serialized item ${item.material_id} with ${balanceIndexData.length} serial balances`
  );

  const serialBalances = parseBalanceIndexForSerials(balanceIndexData);

  if (serialBalances.length === 0) {
    console.log(
      `No serial numbers found for serialized item ${item.material_id}`
    );
    return;
  }

  // Calculate net quantity change for costing updates
  let netQuantityChange = 0;
  let totalInCost = 0;
  let totalInQuantity = 0;

  for (const balance of serialBalances) {
    if (adjustment_type === "Write Off") {
      netQuantityChange -= balance.sa_quantity; // Deduct quantity
    } else if (adjustment_type === "Stock Count") {
      if (balance.movement_type === "In") {
        netQuantityChange += balance.sa_quantity; // Add quantity
        totalInCost += (item.unit_price || 0) * balance.sa_quantity;
        totalInQuantity += balance.sa_quantity;
      } else if (balance.movement_type === "Out") {
        netQuantityChange -= balance.sa_quantity; // Deduct quantity
      }
    }
  }

  console.log(
    `Serialized item ${item.material_id} net quantity change: ${netQuantityChange}`
  );

  // Update costing methods (WA/FIFO) for serialized items
  if (netQuantityChange !== 0) {
    try {
      // Calculate weighted average unit price for "In" movements
      const balanceUnitPrice =
        totalInQuantity > 0
          ? totalInCost / totalInQuantity
          : item.unit_price || materialData.purchase_unit_price || 0;

      console.log(
        `Updating costing for serialized item ${item.material_id}, quantity change: ${netQuantityChange}, unit price: ${balanceUnitPrice}`
      );

      await updateQuantities(
        netQuantityChange,
        balanceUnitPrice,
        materialData,
        item,
        plant_id,
        organization_id
      );
    } catch (error) {
      console.error(
        `Error updating costing for serialized item ${item.material_id}:`,
        error
      );
      throw error;
    }
  }

  // Step 1: Update individual serial balances
  for (const balance of serialBalances) {
    const serialNumber = balance.serial_number;
    const batchId =
      materialData.item_batch_management == "1" ? balance.batch_id : null;
    const locationId = balance.location_id;
    const category = balance.category || "Unrestricted";
    const saQuantity = balance.sa_quantity;

    console.log(
      `Processing serial balance for ${serialNumber} with quantity ${saQuantity} in category ${category}`
    );

    try {
      // Determine quantity change based on adjustment type and movement type
      let qtyChange = 0;

      if (adjustment_type === "Write Off") {
        qtyChange = -saQuantity; // Deduct quantity
      } else if (adjustment_type === "Stock Count") {
        // For stock count, check if it's In or Out movement
        if (balance.movement_type === "In") {
          qtyChange = saQuantity; // Add quantity
        } else if (balance.movement_type === "Out") {
          qtyChange = -saQuantity; // Deduct quantity
        }
      }

      if (qtyChange !== 0) {
        await updateSerialBalance(
          item.material_id,
          serialNumber,
          batchId,
          locationId,
          category,
          qtyChange,
          plant_id,
          organization_id
        );
      }
    } catch (error) {
      console.error(
        `Error processing serial balance for ${serialNumber}:`,
        error
      );
      throw error;
    }
  }

  // Step 2: Group serial balances by location + batch + category + movement_type for consolidated inventory movements
  const groupedBalances = new Map();

  for (const balance of serialBalances) {
    const batchId =
      materialData.item_batch_management == "1" ? balance.batch_id : null;
    const locationId = balance.location_id;
    const category = balance.category || "Unrestricted";
    const movementType = balance.movement_type || "Out"; // Default to Out for Write Off

    // Create grouping key: location + batch + category + movement_type
    const groupKey = `${locationId || "no-location"}|${
      batchId || "no-batch"
    }|${category}|${movementType}`;

    if (!groupedBalances.has(groupKey)) {
      groupedBalances.set(groupKey, {
        location_id: locationId,
        batch_id: batchId,
        category: category,
        movement_type: movementType,
        total_quantity: 0,
        serial_numbers: [],
      });
    }

    const group = groupedBalances.get(groupKey);
    group.total_quantity += balance.sa_quantity;
    group.serial_numbers.push({
      serial_number: balance.serial_number,
      quantity: balance.sa_quantity,
    });
  }

  console.log(
    `Grouped ${serialBalances.length} serial balances into ${groupedBalances.size} consolidated inventory movements`
  );

  // Step 3: Create consolidated inventory movements for each group
  for (const [groupKey, group] of groupedBalances) {
    console.log(
      `Creating consolidated inventory movement for group: ${groupKey}, total qty: ${group.total_quantity}`
    );

    try {
      // Calculate pricing based on costing method
      let unitPrice = roundPrice(item.unit_price || 0);
      let totalPrice = roundPrice(item.unit_price * group.total_quantity);

      const costingMethod = materialData.material_costing_method;
      const movementType = group.movement_type === "In" ? "IN" : "OUT";

      if (costingMethod === "First In First Out") {
        const fifoCostPrice = await getLatestFIFOCostPrice(
          item.material_id,
          group.batch_id,
          movementType === "OUT" ? group.total_quantity : null
        );
        unitPrice = roundPrice(fifoCostPrice);
        totalPrice = roundPrice(fifoCostPrice * group.total_quantity);
      } else if (costingMethod === "Weighted Average") {
        const waCostPrice = await getWeightedAverageCostPrice(
          item.material_id,
          group.batch_id
        );
        unitPrice = roundPrice(waCostPrice);
        totalPrice = roundPrice(waCostPrice * group.total_quantity);
      } else if (costingMethod === "Fixed Cost") {
        const fixedCostPrice = await getFixedCostPrice(item.material_id);
        unitPrice = roundPrice(fixedCostPrice);
        totalPrice = roundPrice(fixedCostPrice * group.total_quantity);
      }

      // Create consolidated inventory movement
      const inventoryMovementData = {
        transaction_type: "SA",
        trx_no: allData.adjustment_no,
        parent_trx_no: null,
        movement: movementType,
        unit_price: unitPrice,
        total_price: totalPrice,
        quantity: roundQty(group.total_quantity),
        item_id: item.material_id,
        inventory_category: group.category,
        uom_id: materialData.based_uom,
        base_qty: roundQty(group.total_quantity),
        base_uom_id: materialData.based_uom,
        bin_location_id: group.location_id,
        batch_number_id: group.batch_id,
        costing_method_id: materialData.material_costing_method,
        created_at: new Date(),
        adjustment_type: adjustment_type,
        plant_id: plant_id,
        organization_id: organization_id,
      };

      await db.collection("inventory_movement").add(inventoryMovementData);
      console.log(
        `Consolidated inventory movement created for group ${groupKey}`
      );

      // Wait and fetch the created movement ID
      await new Promise((resolve) => setTimeout(resolve, 100));

      const movementQuery = await db
        .collection("inventory_movement")
        .where({
          transaction_type: "SA",
          trx_no: allData.adjustment_no,
          movement: movementType,
          inventory_category: group.category,
          item_id: item.material_id,
          bin_location_id: group.location_id,
          base_qty: roundQty(group.total_quantity),
          plant_id: plant_id,
          organization_id: organization_id,
        })
        .get();

      if (movementQuery.data && movementQuery.data.length > 0) {
        const movementId = movementQuery.data.sort(
          (a, b) => new Date(b.create_time) - new Date(a.create_time)
        )[0].id;
        console.log(`Retrieved inventory movement ID: ${movementId}`);

        // Step 4: Create individual serial movement records for each serial in this group
        for (const serialInfo of group.serial_numbers) {
          await createSerialMovementRecord(
            movementId,
            serialInfo.serial_number,
            group.batch_id,
            serialInfo.quantity,
            materialData.based_uom,
            plant_id,
            organization_id
          );
        }
      } else {
        console.error(
          `Failed to retrieve inventory movement for group ${groupKey}`
        );
        throw new Error(
          `Failed to retrieve inventory movement for group ${groupKey}`
        );
      }

      console.log(
        `Created ${group.serial_numbers.length} serial movement records for group ${groupKey}`
      );
    } catch (groupError) {
      console.error(`Error processing group ${groupKey}:`, groupError);
      throw groupError;
    }
  }

  console.log(
    `Successfully processed ${serialBalances.length} serial balances in ${groupedBalances.size} consolidated movements for item ${item.material_id}`
  );
};

const updateQuantities = async (
  quantityChange,
  balanceUnitPrice,
  materialDataParam = null,
  itemParam = null,
  plantIdParam = null,
  organizationIdParam = null
) => {
  try {
    // Use passed parameters or fallback to local scope variables
    const currentMaterialData = materialDataParam || materialData;
    const currentItem = itemParam || item;
    const currentPlantId = plantIdParam || plant_id;
    const currentOrganizationId = organizationIdParam || organization_id;

    if (!currentMaterialData?.id) {
      throw new Error("Invalid material data: material_id is missing");
    }

    if (!currentMaterialData.material_costing_method) {
      throw new Error("Material costing method is not defined");
    }

    const costingMethod = currentMaterialData.material_costing_method;

    if (
      !["Weighted Average", "First In First Out", "Fixed Cost"].includes(
        costingMethod
      )
    ) {
      throw new Error(`Unsupported costing method: ${costingMethod}`);
    }

    const unitPrice =
      balanceUnitPrice !== undefined
        ? roundPrice(balanceUnitPrice)
        : roundPrice(currentMaterialData.purchase_unit_price || 0);
    const batchId =
      currentMaterialData.item_batch_management == "1"
        ? currentItem.item_batch_no
        : null;

    if (costingMethod === "Weighted Average") {
      const waQueryConditions =
        currentMaterialData.item_batch_management == "1" && batchId
          ? {
              material_id: currentMaterialData.id,
              batch_id: batchId,
              plant_id: currentPlantId,
            }
          : {
              material_id: currentMaterialData.id,
              plant_id: currentPlantId,
            };

      await logTableState(
        "wa_costing_method",
        waQueryConditions,
        `Before WA update for material ${currentMaterialData.id}`
      );

      const waQuery = db
        .collection("wa_costing_method")
        .where(waQueryConditions);

      const waResponse = await waQuery.get();
      const waData = Array.isArray(waResponse?.data) ? waResponse.data : [];

      if (waData.length > 0) {
        const latestWa = waData.sort(
          (a, b) => new Date(b.created_at) - new Date(a.created_at)
        )[0];
        const currentQty = roundQty(latestWa.wa_quantity || 0);
        const currentTotalCost =
          roundPrice(latestWa.wa_cost_price || 0) * currentQty;

        let newWaQuantity, newWaCostPrice;
        if (quantityChange > 0) {
          const addedCost = roundPrice(unitPrice * quantityChange);
          newWaQuantity = roundQty(currentQty + quantityChange);
          newWaCostPrice =
            newWaQuantity > 0
              ? roundPrice((currentTotalCost + addedCost) / newWaQuantity)
              : 0;
        } else {
          newWaQuantity = roundQty(currentQty + quantityChange);
          newWaCostPrice = latestWa.wa_cost_price
            ? roundPrice(latestWa.wa_cost_price)
            : 0;
        }

        if (newWaQuantity < 0) {
          throw new Error("Insufficient WA quantity");
        }

        await db.collection("wa_costing_method").doc(latestWa.id).update({
          wa_quantity: newWaQuantity,
          wa_cost_price: newWaCostPrice,
          updated_at: new Date(),
        });

        await logTableState(
          "wa_costing_method",
          waQueryConditions,
          `After WA update for material ${currentMaterialData.id}`
        );
      } else if (quantityChange > 0) {
        await db.collection("wa_costing_method").add({
          material_id: currentMaterialData.id,
          batch_id: batchId || null,
          plant_id: currentPlantId,
          organization_id: currentOrganizationId,
          wa_quantity: roundQty(quantityChange),
          wa_cost_price: roundPrice(unitPrice),
          created_at: new Date(),
        });

        await logTableState(
          "wa_costing_method",
          waQueryConditions,
          `After adding new WA record for material ${currentMaterialData.id}`
        );
      } else {
        throw new Error("No WA costing record found for deduction");
      }
    } else if (costingMethod === "First In First Out") {
      const fifoQueryConditions =
        currentMaterialData.item_batch_management == "1" && batchId
          ? { material_id: currentMaterialData.id, batch_id: batchId }
          : { material_id: currentMaterialData.id };

      await logTableState(
        "fifo_costing_history",
        fifoQueryConditions,
        `Before FIFO update for material ${currentMaterialData.id}`
      );

      const fifoQuery = db
        .collection("fifo_costing_history")
        .where(fifoQueryConditions);

      const fifoResponse = await fifoQuery.get();
      const fifoData = Array.isArray(fifoResponse?.data)
        ? fifoResponse.data
        : [];
      const lastSequence =
        fifoData.length > 0
          ? Math.max(...fifoData.map((record) => record.fifo_sequence || 0))
          : 0;
      const newSequence = lastSequence + 1;

      if (quantityChange > 0) {
        await db.collection("fifo_costing_history").add({
          material_id: currentMaterialData.id,
          batch_id: batchId || null,
          plant_id: currentPlantId,
          organization_id: currentOrganizationId,
          fifo_initial_quantity: roundQty(quantityChange),
          fifo_available_quantity: roundQty(quantityChange),
          fifo_cost_price: roundPrice(unitPrice),
          fifo_sequence: newSequence,
          created_at: new Date(),
        });

        await logTableState(
          "fifo_costing_history",
          fifoQueryConditions,
          `After adding new FIFO record for material ${currentMaterialData.id}`
        );
      } else if (quantityChange < 0) {
        let remainingReduction = roundQty(-quantityChange);

        if (fifoData.length > 0) {
          // Sort by sequence (oldest first)
          fifoData.sort((a, b) => a.fifo_sequence - b.fifo_sequence);

          for (const fifoRecord of fifoData) {
            if (remainingReduction <= 0) break;

            const available = roundQty(fifoRecord.fifo_available_quantity || 0);
            const reduction = roundQty(Math.min(available, remainingReduction));
            const newAvailable = roundQty(available - reduction);

            await db
              .collection("fifo_costing_history")
              .doc(fifoRecord.id)
              .update({
                fifo_available_quantity: newAvailable,
                updated_at: new Date(),
              });

            remainingReduction = roundQty(remainingReduction - reduction);
          }

          if (remainingReduction > 0) {
            throw new Error(
              `Insufficient FIFO quantity for material ${
                currentMaterialData.id
              }. Available: ${roundQty(
                fifoData.reduce(
                  (sum, record) => sum + (record.fifo_available_quantity || 0),
                  0
                )
              )}, Requested: ${roundQty(-quantityChange)}`
            );
          }

          await logTableState(
            "fifo_costing_history",
            fifoQueryConditions,
            `After FIFO update for material ${currentMaterialData.id}`
          );
        } else {
          throw new Error(
            `No FIFO costing records found for deduction for material ${currentMaterialData.id}`
          );
        }
      }
    }
  } catch (error) {
    console.error("Error in updateQuantities:", {
      message: error.message,
      stack: error.stack,
      materialData: currentMaterialData,
      quantityChange,
      plant_id: currentPlantId,
      unitPrice,
      batchId,
    });
    throw new Error(
      `Failed to update costing method: ${error.message || "Unknown error"}`
    );
  }
};

const updateInventory = (allData) => {
  const subformData = allData.stock_adjustment;
  const plant_id = allData.plant_id;
  const organization_id = allData.organization_id;
  const adjustment_type = allData.adjustment_type;
  console.log("allData", adjustment_type);

  subformData.forEach((item) => {
    console.log("Processing item:", item.total_quantity);
    const balanceIndexData = JSON.parse(item.balance_index);

    db.collection("Item")
      .where({
        id: item.material_id,
      })
      .get()
      .then(async (response) => {
        const materialData = response.data[0];
        console.log("materialData:", materialData.id);

        // Check if item is serialized and handle accordingly
        if (isSerializedItem(materialData)) {
          console.log(
            `Item ${item.material_id} is serialized, using serial balance processing`
          );
          try {
            await processSerializedItemAdjustment(
              item,
              materialData,
              balanceIndexData,
              adjustment_type,
              plant_id,
              organization_id,
              allData
            );
          } catch (error) {
            console.error(
              `Error processing serialized item ${item.material_id}:`,
              error
            );
          }
          return; // Skip regular balance processing for serialized items
        }

        const updateBalance = async (balance) => {
          const categoryMap = {
            Unrestricted: "unrestricted_qty",
            Reserved: "reserved_qty",
            "Quality Inspection": "qualityinsp_qty",
            Blocked: "block_qty",
          };

          const qtyField = categoryMap[balance.category];
          const qtyChange =
            balance.movement_type === "In"
              ? roundQty(balance.sa_quantity)
              : roundQty(-balance.sa_quantity);
          const collectionName =
            materialData.item_batch_management == "1"
              ? "item_batch_balance"
              : "item_balance";

          const balanceQueryCondition =
            materialData.item_batch_management == "1" && balance.batch_id
              ? {
                  material_id: materialData.id,
                  location_id: balance.location_id,
                  batch_id: balance.batch_id,
                }
              : {
                  material_id: materialData.id,
                  location_id: balance.location_id,
                };

          await logTableState(
            collectionName,
            balanceQueryCondition,
            `Before balance update for material ${materialData.id}, location ${balance.location_id}`
          );

          const balanceQuery = db
            .collection(collectionName)
            .where(balanceQueryCondition);

          let balanceData = null;
          const response = await balanceQuery.get();
          balanceData = response.data[0];

          if (!balanceData) {
            const initialData = {
              material_id: materialData.id,
              location_id: balance.location_id,
              batch_id: balance.batch_id || "",
              balance_quantity: 0,
              unrestricted_qty: 0,
              reserved_qty: 0,
              qualityinsp_qty: 0,
              block_qty: 0,
              plant_id: plant_id,
              organization_id: organization_id,
            };
            await db.collection(collectionName).add(initialData);

            await logTableState(
              collectionName,
              balanceQueryCondition`After adding new balance record for material ${materialData.id}, location ${balance.location_id}`
            );

            const newResponse = await balanceQuery.get();
            balanceData = newResponse.data[0];
          }

          const newBalanceQty = roundQty(
            balanceData.balance_quantity + qtyChange
          );
          const newCategoryQty = roundQty(
            (balanceData[qtyField] || 0) + qtyChange
          );
          console.log("newBalanceQty", newBalanceQty);
          console.log("newCategoryQty", newCategoryQty);
          if (newBalanceQty < 0 || newCategoryQty < 0) {
            throw new Error(
              `Insufficient quantity in ${collectionName} for ${balance.category}`
            );
          }

          const updateData = {
            balance_quantity: newBalanceQty,
            [qtyField]: newCategoryQty,
          };

          await db
            .collection(collectionName)
            .where(balanceQueryCondition)
            .update(updateData);

          await logTableState(
            collectionName,
            balanceQueryCondition,
            `After balance update for material ${materialData.id}, location ${balance.location_id}`
          );

          return balanceData;
        };

        const recordInventoryMovement = async (balance) => {
          const movementType = balance.movement_type === "In" ? "IN" : "OUT";

          await logTableState(
            "inventory_movement",
            { trx_no: allData.adjustment_no, item_id: item.material_id },
            `Before adding inventory movement for adjustment ${allData.adjustment_no}, material ${item.material_id}`
          );

          let initialUnitPrice = roundPrice(item.unit_price || 0);
          let unitPrice = roundPrice(item.unit_price || 0);
          let totalPrice = roundPrice(item.unit_price * balance.sa_quantity);

          const costingMethod = materialData.material_costing_method;

          if (costingMethod === "First In First Out") {
            const fifoCostPrice = await getLatestFIFOCostPrice(
              item.material_id,
              item.item_batch_no,
              movementType === "OUT" ? balance.sa_quantity : null
            );
            unitPrice = roundPrice(fifoCostPrice);
            totalPrice = roundPrice(fifoCostPrice * balance.sa_quantity);
          } else if (costingMethod === "Weighted Average") {
            // Get unit price from WA cost price
            const waCostPrice = await getWeightedAverageCostPrice(
              item.material_id,
              item.item_batch_no
            );
            unitPrice = roundPrice(waCostPrice);
            totalPrice = roundPrice(waCostPrice * balance.sa_quantity);
          } else if (costingMethod === "Fixed Cost") {
            // Get unit price from Fixed Cost
            const fixedCostPrice = await getFixedCostPrice(item.material_id);
            unitPrice = roundPrice(fixedCostPrice);
            totalPrice = roundPrice(fixedCostPrice * balance.sa_quantity);
          } else {
            return Promise.resolve();
          }

          const inventoryMovementData = {
            transaction_type: "SA",
            trx_no: allData.adjustment_no,
            parent_trx_no: null,
            movement: movementType,
            unit_price: movementType === "IN" ? initialUnitPrice : unitPrice,
            total_price: totalPrice,
            quantity: roundQty(balance.sa_quantity),
            item_id: item.material_id,
            inventory_category: balance.category,
            uom_id: materialData.based_uom,
            base_qty: roundQty(balance.sa_quantity),
            base_uom_id: materialData.based_uom,
            bin_location_id: balance.location_id,
            batch_number_id:
              materialData.item_batch_management == "1"
                ? item.item_batch_no
                : null,
            costing_method_id: materialData.material_costing_method,
            created_at: new Date(),
            adjustment_type: adjustment_type,
            plant_id: plant_id,
            organization_id: organization_id,
          };

          await db.collection("inventory_movement").add(inventoryMovementData);
          console.log("Inventory movement recorded");

          // Wait and fetch the created movement ID
          await new Promise((resolve) => setTimeout(resolve, 100));

          const singleMovementQuery = await db
            .collection("inventory_movement")
            .where({
              transaction_type: "SA",
              trx_no: allData.adjustment_no,
              movement: movementType,
              inventory_category: balance.category,
              item_id: item.material_id,
              bin_location_id: balance.location_id,
              base_qty: roundQty(balance.sa_quantity),
              plant_id: plant_id,
              organization_id: organization_id,
            })
            .get();

          if (singleMovementQuery.data && singleMovementQuery.data.length > 0) {
            const singleMovementId = singleMovementQuery.data.sort(
              (a, b) => new Date(b.create_time) - new Date(a.create_time)
            )[0].id;
            console.log(
              `Retrieved single inventory movement ID: ${singleMovementId}`
            );

            // Create serial movement record if item is serialized and has serial number
            if (isSerializedItem(materialData) && balance.serial_number) {
              try {
                await createSerialMovementRecord(
                  singleMovementId,
                  balance.serial_number,
                  materialData.item_batch_management == "1"
                    ? balance.batch_id
                    : null,
                  balance.sa_quantity,
                  materialData.based_uom,
                  plant_id,
                  organization_id
                );
              } catch (serialError) {
                console.error(
                  `Error creating serial movement for ${balance.serial_number}:`,
                  serialError
                );
              }
            }
          } else {
            console.error("Failed to retrieve single inventory movement");
          }

          await logTableState(
            "inventory_movement",
            { trx_no: allData.adjustment_no, item_id: item.material_id },
            `After adding inventory movement for adjustment ${allData.adjustment_no}, material ${item.material_id}`
          );

          return invMovementResult;
        };

        if (adjustment_type === "Write Off") {
          // For Write Off, assume unit_price is consistent across balance_index entries
          const balanceUnitPrice =
            balanceIndexData && balanceIndexData.length > 0
              ? item.unit_price || materialData.purchase_unit_price || 0
              : materialData.purchase_unit_price || 0;

          return updateQuantities(
            -item.total_quantity,
            balanceUnitPrice,
            materialData,
            item,
            plant_id,
            organization_id
          )
            .then(() => {
              if (balanceIndexData && Array.isArray(balanceIndexData)) {
                return balanceIndexData
                  .filter((balance) => balance.sa_quantity > 0)
                  .reduce((promise, balance) => {
                    return promise.then(() => {
                      return updateBalance(balance).then(() => {
                        return recordInventoryMovement(balance);
                      });
                    });
                  }, Promise.resolve());
              }
              return null;
            })
            .then((responses) => {
              if (responses) {
                console.log("Write Off update responses:", responses);
              }
            })
            .catch((error) => {
              console.error("Error in Write Off processing:", error);
              throw error;
            });
        } else if (adjustment_type === "Stock Count") {
          let netQuantityChange = 0;
          let totalInCost = 0;
          let totalInQuantity = 0;

          if (balanceIndexData && Array.isArray(balanceIndexData)) {
            balanceIndexData.forEach((balance) => {
              if (balance.movement_type === "In") {
                netQuantityChange += balance.sa_quantity;
                totalInCost += (item.unit_price || 0) * balance.sa_quantity;
                totalInQuantity += balance.sa_quantity;
              } else if (balance.movement_type === "Out") {
                netQuantityChange -= balance.sa_quantity;
              }
            });
          }

          // Calculate weighted average unit price for "In" movements
          const balanceUnitPrice =
            totalInQuantity > 0
              ? totalInCost / totalInQuantity
              : materialData.purchase_unit_price || 0;

          return updateQuantities(
            netQuantityChange,
            balanceUnitPrice,
            materialData,
            item,
            plant_id,
            organization_id
          )
            .then(() => {
              if (balanceIndexData && Array.isArray(balanceIndexData)) {
                return balanceIndexData
                  .filter((balance) => balance.sa_quantity > 0)
                  .reduce((promise, balance) => {
                    return promise.then(() => {
                      return updateBalance(balance).then(() => {
                        return recordInventoryMovement(balance);
                      });
                    });
                  }, Promise.resolve());
              }
              return null;
            })
            .then((responses) => {
              if (responses) {
                console.log("Stock Count update responses:", responses);
              }
            })
            .catch((error) => {
              console.error("Error in Stock Count processing:", error);
              throw error;
            });
        }
        return Promise.resolve(null);
      })
      .catch((error) => {
        console.error(
          "Error fetching item data or processing adjustment:",
          error
        );
      });
  });
};

async function preCheckQuantitiesAndCosting(allData, context) {
  try {
    console.log("Starting preCheckQuantitiesAndCosting with data:", allData);

    // Step 1: Validate inventory allocation conflicts across items
    validateDuplicateSerialNumbers(allData);

    // Step 3: Perform item validations and quantity checks
    for (const item of allData.stock_adjustment) {
      // Fetch material data
      const materialResponse = await db
        .collection("Item")
        .where({ id: item.material_id })
        .get();
      const materialData = materialResponse.data[0];
      if (!materialData) {
        throw new Error(`Material not found: ${item.material_id}`);
      }
      if (!materialData.material_costing_method) {
        throw new Error(
          `Costing method not defined for item ${item.material_id}`
        );
      }

      const balanceIndexData = JSON.parse(item.balance_index);

      const balancesToProcess =
        balanceIndexData?.filter(
          (balance) => balance.sa_quantity && balance.sa_quantity > 0
        ) || [];

      const adjustment_type = allData.adjustment_type;
      const batchId =
        materialData.item_batch_management == "1" ? item.item_batch_no : null;
      const plant_id = allData.plant_id;

      // Step 4: Check quantities for Write Off or Stock Count (Out movements)
      if (
        adjustment_type === "Write Off" ||
        (adjustment_type === "Stock Count" && item.total_quantity < 0)
      ) {
        const requestedQty = Math.abs(item.total_quantity);

        // Check balance quantities - handle serialized items differently
        for (const balance of balancesToProcess) {
          if (isSerializedItem(materialData)) {
            // For serialized items, check item_serial_balance
            if (!balance.serial_number) {
              throw new Error(
                `Serial number is required for serialized item ${item.material_id}`
              );
            }

            const serialBalanceParams = {
              material_id: materialData.id,
              serial_number: balance.serial_number,
              plant_id: plant_id,
              organization_id: allData.organization_id,
              location_id: balance.location_id,
            };

            if (materialData.item_batch_management == "1" && balance.batch_id) {
              serialBalanceParams.batch_id = balance.batch_id;
            }

            if (balance.location_id) {
              serialBalanceParams.location_id = balance.location_id;
            }

            const serialBalanceQuery = await db
              .collection("item_serial_balance")
              .where(serialBalanceParams)
              .get();

            if (
              !serialBalanceQuery.data ||
              serialBalanceQuery.data.length === 0
            ) {
              throw new Error(
                `No existing serial balance found for item ${item.material_id}, serial ${balance.serial_number} at location ${balance.location_id}`
              );
            }

            const serialBalanceData = serialBalanceQuery.data[0];
            const categoryMap = {
              Unrestricted: "unrestricted_qty",
              Reserved: "reserved_qty",
              "Quality Inspection": "qualityinsp_qty",
              Blocked: "block_qty",
            };
            const categoryField =
              categoryMap[balance.category || "Unrestricted"];
            const currentQty = serialBalanceData[categoryField] || 0;

            if (currentQty < balance.sa_quantity) {
              throw new Error(
                `Insufficient quantity in ${
                  balance.category || "Unrestricted"
                } for serialized item ${item.material_id}, serial ${
                  balance.serial_number
                } at location ${
                  balance.location_id
                }. Available: ${currentQty}, Requested: ${balance.sa_quantity}`
              );
            }
          } else {
            // For non-serialized items, use existing logic
            const collectionName =
              materialData.item_batch_management == "1"
                ? "item_batch_balance"
                : "item_balance";
            const balanceQuery = db.collection(collectionName).where({
              material_id: materialData.id,
              location_id: balance.location_id,
              plant_id: plant_id,
            });
            const balanceResponse = await balanceQuery.get();
            const balanceData = balanceResponse.data[0];

            if (!balanceData) {
              throw new Error(
                `No existing balance found for item ${item.material_id} at location ${balance.location_id}`
              );
            }

            const categoryMap = {
              Unrestricted: "unrestricted_qty",
              Reserved: "reserved_qty",
              "Quality Inspection": "qualityinsp_qty",
              Blocked: "block_qty",
            };
            const categoryField =
              categoryMap[balance.category || "Unrestricted"];
            const currentQty = balanceData[categoryField] || 0;

            if (currentQty < balance.sa_quantity) {
              throw new Error(
                `Insufficient quantity in ${
                  balance.category || "Unrestricted"
                } for item ${item.material_id} at location ${
                  balance.location_id
                }. Available: ${currentQty}, Requested: ${balance.sa_quantity}`
              );
            }
          }
        }

        // Step 5: Check costing records
        const costingMethod = materialData.material_costing_method;

        if (costingMethod === "Weighted Average") {
          const waQueryConditions =
            materialData.item_batch_management == "1" && batchId
              ? {
                  material_id: materialData.id,
                  batch_id: batchId,
                  plant_id: plant_id,
                }
              : { material_id: materialData.id, plant_id: plant_id };

          const waQuery = db
            .collection("wa_costing_method")
            .where(waQueryConditions);
          const waResponse = await waQuery.get();
          const waData = Array.isArray(waResponse?.data) ? waResponse.data : [];

          if (waData.length === 0) {
            throw new Error(
              `No costing record found for deduction for item ${item.material_id} (Weighted Average)`
            );
          }

          const latestWa = waData.sort(
            (a, b) => new Date(b.created_at) - new Date(a.created_at)
          )[0];
          const currentQty = latestWa.wa_quantity || 0;

          if (currentQty < requestedQty) {
            throw new Error(
              `Insufficient WA quantity for item ${item.material_id}. Available: ${currentQty}, Requested: ${requestedQty}`
            );
          }
        } else if (costingMethod === "First In First Out") {
          const fifoQueryConditions =
            materialData.item_batch_management == "1" && batchId
              ? { material_id: materialData.id, batch_id: batchId }
              : { material_id: materialData.id };

          const fifoQuery = db
            .collection("fifo_costing_history")
            .where(fifoQueryConditions);
          const fifoResponse = await fifoQuery.get();
          const fifoData = Array.isArray(fifoResponse?.data)
            ? fifoResponse.data
            : [];

          if (fifoData.length === 0) {
            throw new Error(
              `No costing record found for deduction for item ${item.material_id} (FIFO)`
            );
          }

          const totalAvailable = fifoData.reduce(
            (sum, record) => sum + (record.fifo_available_quantity || 0),
            0
          );
          if (totalAvailable < requestedQty) {
            throw new Error(
              `Insufficient FIFO quantity for item ${item.material_id}. Available: ${totalAvailable}, Requested: ${requestedQty}`
            );
          }
        }
      }
    }

    // Step 6: If all checks pass, show confirmation popup
    return true;
  } catch (error) {
    console.error("Error in preCheckQuantitiesAndCosting:", error.message);
    if (context && context.parentGenerateForm) {
      context.parentGenerateForm.$alert(error.message, "Validation Error", {
        confirmButtonText: "OK",
        type: "error",
      });
    } else {
      alert(error.message);
    }
    throw error;
  }
}

const validateForm = (data, requiredFields) => {
  const missingFields = [];

  requiredFields.forEach((field) => {
    const value = data[field.name];

    // Handle non-array fields (unchanged)
    if (!field.isArray) {
      if (validateField(value, field)) {
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
          if (validateField(subValue, subField)) {
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

const validateField = (value, _field) => {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return value <= 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return !value;
};

const getPrefixData = async (organizationId) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Stock Adjustment",
      is_deleted: 0,
      organization_id: organizationId,
      is_active: 1,
    })
    .get();

  const prefixData = await prefixEntry.data[0];

  return prefixData;
};

const updatePrefix = async (organizationId, runningNumber) => {
  try {
    await db
      .collection("prefix_configuration")
      .where({
        document_types: "Stock Adjustment",
        is_deleted: 0,
        organization_id: organizationId,
      })
      .update({ running_number: parseInt(runningNumber) + 1, has_record: 1 });
  } catch (error) {
    this.$message.error(error);
  }
};

const generatePrefix = (runNumber, now, prefixData) => {
  let generated = prefixData.current_prefix_config;
  generated = generated.replace("prefix", prefixData.prefix_value);
  generated = generated.replace("suffix", prefixData.suffix_value);
  generated = generated.replace(
    "month",
    String(now.getMonth() + 1).padStart(2, "0")
  );
  generated = generated.replace("day", String(now.getDate()).padStart(2, "0"));
  generated = generated.replace("year", now.getFullYear());
  generated = generated.replace(
    "running_number",
    String(runNumber).padStart(prefixData.padding_zeroes, "0")
  );
  return generated;
};

const checkUniqueness = async (generatedPrefix) => {
  const existingDoc = await db
    .collection("stock_adjustment")
    .where({ adjustment_no: generatedPrefix })
    .get();
  return existingDoc.data[0] ? false : true;
};

const findUniquePrefix = async (prefixData) => {
  const now = new Date();
  let prefixToShow;
  let runningNumber = prefixData.running_number;
  let isUnique = false;
  let maxAttempts = 10;
  let attempts = 0;

  while (!isUnique && attempts < maxAttempts) {
    attempts++;
    prefixToShow = await generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(prefixToShow);
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    this.$message.error(
      "Could not generate a unique Stock Adjustment number after maximum attempts"
    );
  }

  return { prefixToShow, runningNumber };
};

const addEntry = async (organizationId, sa, self) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData.length !== 0) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData
      );

      await updatePrefix(organizationId, runningNumber);

      sa.adjustment_no = prefixToShow;
    }

    await preCheckQuantitiesAndCosting(sa, self);
    await db.collection("stock_adjustment").add(sa);
    await updateInventory(sa);
    await this.runWorkflow(
      "1922123385857220609",
      { adjustment_no: sa.adjustment_no },
      async (res) => {
        console.log("成功结果：", res);
      },
      (err) => {
        console.error("失败结果：", err);
        closeDialog();
      }
    );
    this.$message.success("Add successfully");
    closeDialog();
  } catch (error) {
    this.$message.error(error);
  }
};

const updateEntry = async (organizationId, sa, self, stockAdjustmentId) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData.length !== 0) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData
      );

      await updatePrefix(organizationId, runningNumber);

      sa.adjustment_no = prefixToShow;
    }

    await preCheckQuantitiesAndCosting(sa, self);
    await db.collection("stock_adjustment").doc(stockAdjustmentId).update(sa);
    await updateInventory(sa);
    await this.runWorkflow(
      "1922123385857220609",
      { adjustment_no: sa.adjustment_no },
      async (res) => {
        console.log("成功结果：", res);
      },
      (err) => {
        console.error("失败结果：", err);
        closeDialog();
      }
    );
    this.$message.success("Update successfully");
    await closeDialog();
  } catch (error) {
    this.$message.error(error);
  }
};

const fillbackHeaderFields = async (sa) => {
  try {
    for (const [index, saLineItem] of sa.stock_adjustment.entries()) {
      saLineItem.plant_id = sa.plant_id || null;
      saLineItem.line_index = index + 1;
    }
    return sa.stock_adjustment;
  } catch {
    throw new Error("Error processing Stock Adjustment.");
  }
};

(async () => {
  try {
    this.showLoading();
    const data = this.getValues();
    const page_status = this.getValue("page_status");
    const self = this;
    const stockAdjustmentId = this.getValue("id");
    const requiredFields = [
      { name: "adjustment_date", label: "Adjustment Date" },
      { name: "adjustment_type", label: "Adjustment Type" },
      { name: "plant_id", label: "Plant" },
      {
        name: "stock_adjustment",
        label: "Stock Adjustment Details",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    const missingFields = await validateForm(data, requiredFields);
    if (missingFields.length === 0) {
      const {
        organization_id,
        adjustment_date,
        adjustment_type,
        plant_id,
        adjusted_by,
        adjustment_no,
        adjustment_remarks,
        adjustment_remarks2,
        adjustment_remarks3,
        reference_documents,
        stock_adjustment,
        table_index,
      } = data;

      const sa = {
        stock_adjustment_status: "Completed",
        posted_status: "Unposted",
        organization_id,
        adjustment_no,
        adjustment_date,
        adjustment_type,
        adjusted_by,
        plant_id,
        adjustment_remarks,
        adjustment_remarks2,
        adjustment_remarks3,
        reference_documents,
        stock_adjustment,
        table_index,
      };

      sa.stock_adjustment = await fillbackHeaderFields(sa);

      if (page_status === "Add") {
        await addEntry(organization_id, sa, self);
      } else if (page_status === "Edit") {
        await updateEntry(organization_id, sa, self, stockAdjustmentId);
      }
    } else {
      this.hideLoading();
      this.$message.error(`Validation errors: ${missingFields.join(", ")}`);
    }
  } catch (error) {
    this.$message.error(error);
  }
})();
