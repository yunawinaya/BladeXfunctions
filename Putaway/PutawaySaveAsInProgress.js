const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
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

const getPrefixData = async (organizationId) => {
  console.log("Getting prefix data for organization:", organizationId);
  try {
    const prefixEntry = await db
      .collection("prefix_configuration")
      .where({
        document_types: "Transfer Order (Putaway)",
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

const updatePrefix = async (organizationId, runningNumber) => {
  console.log(
    "Updating prefix for organization:",
    organizationId,
    "with running number:",
    runningNumber,
  );
  try {
    await db
      .collection("prefix_configuration")
      .where({
        document_types: "Transfer Order (Putaway)",
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
      String(now.getMonth() + 1).padStart(2, "0"),
    );
    generated = generated.replace(
      "day",
      String(now.getDate()).padStart(2, "0"),
    );
    generated = generated.replace("year", now.getFullYear());
    generated = generated.replace(
      "running_number",
      String(runNumber).padStart(prefixData.padding_zeroes, "0"),
    );
    console.log("Generated prefix:", generated);
    return generated;
  } catch (error) {
    console.error("Error generating prefix:", error);
    throw error;
  }
};

const checkUniqueness = async (generatedPrefix, organizationId) => {
  const existingDoc = await db
    .collection("transfer_order_putaway")
    .where({
      to_id: generatedPrefix,
      organization_id: organizationId,
      is_deleted: 0,
    })
    .get();

  return !existingDoc.data || existingDoc.data.length === 0;
};

const findUniquePrefix = async (prefixData, organizationId) => {
  const now = new Date();
  let prefixToShow;
  let runningNumber = prefixData.running_number || 1;
  let isUnique = false;
  let maxAttempts = 10;
  let attempts = 0;

  while (!isUnique && attempts < maxAttempts) {
    attempts++;
    prefixToShow = generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(prefixToShow, organizationId);
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    throw new Error(
      "Could not generate a unique Putaway number after maximum attempts",
    );
  }

  return { prefixToShow, runningNumber };
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
              `${subField.label} (in ${field.label} #${index + 1})`,
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

// Enhanced quantity validation and line status determination
const validateAndUpdateLineStatuses = (putawayItems) => {
  const errors = [];
  const updatedItems = putawayItems;

  // Helper function to update a single item's status
  const updateItemStatus = (item, index) => {
    // Safely parse quantities
    const qtyToPutaway = parseFloat(item.qty_to_putaway) || 0;
    const pendingProcessQty = parseFloat(item.pending_process_qty) || 0;
    const putawayQty = parseFloat(item.putaway_qty) || 0;

    console.log(
      `Item ${
        item.item_code || index
      }: qtyToPutaway=${qtyToPutaway}, pendingProcessQty=${pendingProcessQty}, putawayQty=${putawayQty}`,
    );

    // Validation checks
    if (putawayQty < 0) {
      errors.push(
        `Putaway quantity cannot be negative for item ${
          item.item_code || `#${index + 1}`
        }`,
      );
      return null;
    }

    if (putawayQty > pendingProcessQty) {
      errors.push(
        `Putaway quantity (${putawayQty}) cannot be greater than quantity to putaway (${pendingProcessQty}) for item ${
          item.item_code || `#${index + 1}`
        }`,
      );
      return null;
    }

    // Determine line status based on quantities
    let lineStatus;
    if (putawayQty === 0) {
      lineStatus = null;
    } else if (putawayQty === pendingProcessQty) {
      lineStatus = "Completed";
    } else if (putawayQty < pendingProcessQty) {
      lineStatus = "In Progress";
    }

    // Calculate pending process quantity
    const pending_process_qty = pendingProcessQty - putawayQty;

    // Update item
    item.line_status = lineStatus || item.line_status;
    item.pending_process_qty = pending_process_qty;

    // Update serial numbers for serialized items - calculate leftover serial numbers
    if (item.is_serialized_item === 1 && pending_process_qty > 0) {
      const leftoverSerialNumbers = calculateLeftoverSerialNumbers(
        item,
        updatedItems,
        index,
      );
      item.serial_numbers = leftoverSerialNumbers;
      console.log(
        `Updated serial_numbers for partially processed item ${item.item_code}: "${leftoverSerialNumbers}"`,
      );
    } else if (item.is_serialized_item === 1 && pending_process_qty === 0) {
      // If fully processed, clear serial numbers
      item.serial_numbers = "";
      console.log(
        `Cleared serial_numbers for fully processed item ${item.item_code}`,
      );
    }

    console.log(`Item ${item.item_code || index} line status: ${lineStatus}`);

    return lineStatus;
  };

  // Process all items first
  const itemStatusMap = new Map();
  for (let index = 0; index < updatedItems.length; index++) {
    const item = updatedItems[index];
    if (
      item.parent_or_child === "Child" ||
      (item.parent_or_child === "Parent" && item.is_split === "No")
    ) {
      // Process child items or standalone items
      const status = updateItemStatus(item, index);
      itemStatusMap.set(item.item_code, status);
    }
  }

  // Process parent items
  for (let index = 0; index < updatedItems.length; index++) {
    const item = updatedItems[index];
    if (item.parent_or_child === "Parent" && item.is_split === "Yes") {
      // Check if all child items are completed
      const childItems = updatedItems.filter(
        (child) =>
          child.parent_index === index && child.parent_or_child === "Child",
      );

      // Calculate parent's pending_process_qty as the sum of child items' pending_process_qty
      const parentPendingProcessQty = childItems.reduce(
        (sum, child) => sum + (parseFloat(child.pending_process_qty) || 0),
        0,
      );

      const allChildrenCompleted = childItems.every(
        (child) => itemStatusMap.get(child.item_code) === "Completed",
      );

      // Update parent status
      item.line_status = allChildrenCompleted ? "Completed" : "In Progress";
      item.pending_process_qty = parentPendingProcessQty;

      // Update serial numbers for serialized parent items in split scenarios
      if (item.is_serialized_item === 1) {
        if (parentPendingProcessQty > 0) {
          // If there's still pending quantity, calculate leftover serial numbers
          const leftoverSerialNumbers = calculateLeftoverSerialNumbers(
            item,
            updatedItems,
            index,
          );
          item.serial_numbers = leftoverSerialNumbers;
          console.log(
            `Updated serial_numbers for partially processed split parent item ${item.item_code}: "${leftoverSerialNumbers}"`,
          );
        } else if (parentPendingProcessQty === 0) {
          // If all children are completed, clear parent serial numbers
          item.serial_numbers = "";
          console.log(
            `Cleared serial_numbers for fully processed split parent item ${item.item_code}`,
          );
        }
      }

      console.log(
        `Parent Item ${item.item_code || index} line status: ${
          item.line_status
        }`,
      );
    }
  }

  return { updatedItems, errors };
};

// Helper function to calculate leftover serial numbers after partial processing
const calculateLeftoverSerialNumbers = (
  item,
  allItems = null,
  itemIndex = null,
) => {
  // Only process serialized items
  if (item.is_serialized_item !== 1) {
    return item.serial_numbers; // Return original if not serialized
  }

  // Get the original serial numbers
  const originalSerialNumbers = item.serial_numbers
    ? item.serial_numbers
        .split(",")
        .map((sn) => sn.trim())
        .filter((sn) => sn !== "")
    : [];

  let allProcessedSerialNumbers = [];

  // Handle split scenarios differently
  if (
    item.parent_or_child === "Parent" &&
    item.is_split === "Yes" &&
    allItems
  ) {
    // For parent items in split scenarios, collect all processed serial numbers from child items
    console.log(
      `Processing split parent item ${item.item_code}: collecting serial numbers from child items`,
    );

    const childItems = allItems.filter(
      (childItem, _childIndex) =>
        childItem.parent_index === itemIndex &&
        childItem.parent_or_child === "Child" &&
        childItem.item_code === item.item_code,
    );

    console.log(
      `Found ${childItems.length} child items for parent ${item.item_code}`,
    );

    // Aggregate all processed serial numbers from child items
    childItems.forEach((childItem, childIdx) => {
      if (Array.isArray(childItem.select_serial_number)) {
        const childProcessedSerials = childItem.select_serial_number
          .map((sn) => sn.trim())
          .filter((sn) => sn !== "");

        allProcessedSerialNumbers = allProcessedSerialNumbers.concat(
          childProcessedSerials,
        );

        console.log(
          `Child item ${
            childIdx + 1
          } processed serials: [${childProcessedSerials.join(", ")}]`,
        );
      }
    });
  } else {
    // For non-split items or child items, use their own select_serial_number
    allProcessedSerialNumbers = Array.isArray(item.select_serial_number)
      ? item.select_serial_number
          .map((sn) => sn.trim())
          .filter((sn) => sn !== "")
      : [];
  }

  console.log(
    `Item ${item.item_code} (${
      item.parent_or_child || "standalone"
    }): Original serial numbers: [${originalSerialNumbers.join(", ")}]`,
  );
  console.log(
    `Item ${item.item_code} (${
      item.parent_or_child || "standalone"
    }): All processed serial numbers: [${allProcessedSerialNumbers.join(", ")}]`,
  );

  // Calculate leftover serial numbers by removing all processed ones
  const leftoverSerialNumbers = originalSerialNumbers.filter(
    (originalSN) => !allProcessedSerialNumbers.includes(originalSN),
  );

  console.log(
    `Item ${item.item_code} (${
      item.parent_or_child || "standalone"
    }): Leftover serial numbers: [${leftoverSerialNumbers.join(", ")}]`,
  );

  // Return the leftover serial numbers as a comma-separated string
  return leftoverSerialNumbers.length > 0
    ? leftoverSerialNumbers.join(", ")
    : "";
};

const addEntry = async (organizationId, toData) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId,
      );

      await updatePrefix(organizationId, runningNumber);
      toData.to_id = prefixToShow;
    }

    for (const item of toData.table_putaway_item) {
      if (item.select_serial_number) {
        item.select_serial_number = null;
      }
    }

    // Add the record
    await db.collection("transfer_order_putaway").add(toData);
  } catch (error) {
    console.error("Error in addEntry:", error);
    throw error;
  }
};

const updateEntry = async (organizationId, toData, toId, originalToStatus) => {
  try {
    if (originalToStatus === "Draft") {
      const prefixData = await getPrefixData(organizationId);

      if (prefixData) {
        const { prefixToShow, runningNumber } = await findUniquePrefix(
          prefixData,
          organizationId,
        );

        await updatePrefix(organizationId, runningNumber);
        toData.to_id = prefixToShow;
      }
    }

    for (const item of toData.table_putaway_item) {
      if (item.select_serial_number) {
        item.select_serial_number = null;
      }
    }

    await db.collection("transfer_order_putaway").doc(toId).update(toData);

    console.log("Transfer order updated successfully");
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

const updateGoodsReceivingPutawayStatus = async (grId) => {
  try {
    const gr = await db.collection("goods_receiving").doc(grId).get();
    const grData = gr.data[0];
    const putawayStatus = grData.putaway_status;

    if (putawayStatus === "Completed") {
      this.$message.error("Goods Received is already completed");
      return;
    }

    const newPutawayStatus = "In Progress";
    await db.collection("goods_receiving").doc(grId).update({
      putaway_status: newPutawayStatus,
    });

    this.$message.success(
      "Goods Receiving putaway status updated successfully",
    );
  } catch (error) {
    this.$message.error("Error updating Goods Receiving putaway status");
    console.error("Error flipping Goods Receiving putaway status:", error);
  }
};

const createPutawayRecords = async (toData, tablePutawayItem) => {
  const putawayRecords = [];
  for (const item of tablePutawayItem) {
    if (item.parent_or_child === "Parent" && item.is_split === "Yes") {
      continue;
    }

    if (item.putaway_qty > 0) {
      const putawayRecord = {
        line_index: item.line_index,
        item_code: item.item_code,
        item_name: item.item_name,
        item_desc: item.item_desc,
        batch_no: item.batch_no,
        source_inv_category: item.source_inv_category,
        target_inv_category: item.target_inv_category,
        store_in_qty: item.putaway_qty,
        item_uom: item.item_uom,
        target_location: item.target_location,
        remark: item.remark,
        confirmed_by: this.getVarGlobal("nickname"),
        confirmed_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      };

      // Add serial numbers for serialized items
      if (
        item.is_serialized_item === 1 &&
        item.select_serial_number &&
        Array.isArray(item.select_serial_number)
      ) {
        const trimmedSerialNumbers = item.select_serial_number
          .map((sn) => sn.trim())
          .filter((sn) => sn !== "");

        if (trimmedSerialNumbers.length > 0) {
          putawayRecord.serial_numbers = trimmedSerialNumbers.join("\n");

          console.log(
            `Added ${trimmedSerialNumbers.length} serial numbers to putaway record for ${item.item_code}: ${putawayRecord.serial_numbers}`,
          );
        }
      }

      putawayRecords.push(putawayRecord);
    }
  }

  toData.table_putaway_records =
    toData.table_putaway_records.concat(putawayRecords);
};

const addInventoryMovementData = async (
  data,
  movementType,
  itemData,
  matData,
) => {
  try {
    let basedQty = 0;

    if (matData.item_uom !== itemData.based_uom) {
      for (const uom of itemData.table_uom_conversion) {
        if (matData.item_uom === uom.alt_uom_id) {
          basedQty = roundQty(matData.putaway_qty * uom.base_qty);
        }
      }
    } else if (matData.item_uom === itemData.based_uom) {
      basedQty = roundQty(matData.putaway_qty);
    }

    const inventoryMovementData = {
      transaction_type: "TO - PA",
      trx_no: data.to_id,
      inventory_category:
        movementType === "OUT"
          ? matData.source_inv_category
          : matData.target_inv_category,
      parent_trx_no: data.receiving_no,
      movement: movementType,
      unit_price: roundPrice(matData.unit_price),
      total_price: roundPrice(matData.unit_price * basedQty),
      quantity: matData.putaway_qty,
      base_qty: roundQty(basedQty),
      uom_id: matData.item_uom,
      base_uom_id: itemData.based_uom,
      item_id: matData.item_code,
      bin_location_id:
        movementType === "OUT" ? matData.source_bin : matData.target_location,
      batch_number_id: matData.batch_no || "",
      costing_method_id: itemData.material_costing_method,
      plant_id: data.plant_id,
      organization_id: data.organization_id,
    };

    await db.collection("inventory_movement").add(inventoryMovementData);
  } catch {
    throw new Error("Error occurred in inventory movement.");
  }
};

// Helper function to process serialized item movements with consolidation
const processSerializedItemMovement = async (
  data,
  itemData,
  matData,
  movementType,
  serialNumbers,
) => {
  try {
    console.log(
      `Processing serialized item movement for ${matData.item_code}, movement: ${movementType} with ${serialNumbers.length} serials`,
    );

    // Create CONSOLIDATED inventory movement for all serial numbers
    const consolidatedQty = serialNumbers.length; // Each serial = 1 unit
    const inventoryMovementData = {
      transaction_type: "TO - PA",
      trx_no: data.to_id,
      inventory_category:
        movementType === "OUT"
          ? matData.source_inv_category
          : matData.target_inv_category,
      parent_trx_no: data.receiving_no,
      movement: movementType,
      unit_price: roundPrice(matData.unit_price),
      total_price: roundPrice(matData.unit_price * consolidatedQty),
      quantity: consolidatedQty, // Total quantity for all serials
      base_qty: consolidatedQty, // Total base quantity
      uom_id: matData.item_uom,
      base_uom_id: itemData.based_uom,
      item_id: matData.item_code,
      bin_location_id:
        movementType === "OUT" ? matData.source_bin : matData.target_location,
      batch_number_id: matData.batch_no || "",
      costing_method_id: itemData.material_costing_method,
      plant_id: data.plant_id,
      organization_id: data.organization_id,
    };

    await db.collection("inventory_movement").add(inventoryMovementData);
    console.log(
      `Created consolidated ${movementType} movement for ${consolidatedQty} serial numbers`,
    );

    // Wait and fetch the created movement ID
    await new Promise((resolve) => setTimeout(resolve, 100));

    const movementQuery = await db
      .collection("inventory_movement")
      .where({
        transaction_type: "TO - PA",
        trx_no: data.to_id,
        parent_trx_no: data.receiving_no,
        movement: movementType,
        inventory_category: inventoryMovementData.inventory_category,
        item_id: matData.item_code,
        bin_location_id: inventoryMovementData.bin_location_id,
        base_qty: consolidatedQty,
        plant_id: data.plant_id,
        organization_id: data.organization_id,
      })
      .get();

    if (movementQuery.data && movementQuery.data.length > 0) {
      const movementId = movementQuery.data.sort(
        (a, b) => new Date(b.create_time) - new Date(a.create_time),
      )[0].id;
      console.log(`Found consolidated movement ID: ${movementId}`);

      // Create individual inv_serial_movement records for each serial number
      console.log(
        `Creating ${serialNumbers.length} inv_serial_movement records`,
      );

      for (const serialNumber of serialNumbers) {
        const trimmedSerialNumber = serialNumber.trim();
        if (!trimmedSerialNumber) continue;

        console.log(
          `Creating inv_serial_movement for serial: ${trimmedSerialNumber}`,
        );

        try {
          await db.collection("inv_serial_movement").add({
            inventory_movement_id: movementId,
            serial_number: trimmedSerialNumber,
            batch_id: matData.batch_no || null,
            base_qty: 1, // Each serial number is 1 unit
            base_uom: itemData.based_uom,
            plant_id: data.plant_id,
            organization_id: data.organization_id,
          });

          console.log(
            `✓ Created inv_serial_movement for serial ${trimmedSerialNumber}`,
          );

          // Process individual serial balance movement
          await processSerialBalanceMovement(
            matData,
            itemData,
            trimmedSerialNumber,
            movementType,
            data,
          );
        } catch (serialError) {
          console.error(
            `Error creating inv_serial_movement for serial ${trimmedSerialNumber}:`,
            serialError,
          );
          throw serialError;
        }
      }

      // ✅ CRITICAL FIX: For serialized items, also update item_balance (aggregated across all serial numbers)
      try {
        const generalItemBalanceParams = {
          material_id: matData.item_code,
          location_id:
            movementType === "OUT"
              ? matData.source_bin
              : matData.target_location,
          plant_id: data.plant_id,
          organization_id: data.organization_id,
        };
        // Don't include serial_number in item_balance query (aggregated balance across all serials)

        const generalBalanceQuery = await db
          .collection("item_balance")
          .where(generalItemBalanceParams)
          .get();

        const consolidatedQty = serialNumbers.length; // Each serial = 1 unit
        const inventoryCategory =
          movementType === "OUT"
            ? matData.source_inv_category
            : matData.target_inv_category;

        if (generalBalanceQuery.data && generalBalanceQuery.data.length > 0) {
          // Update existing item_balance
          const generalBalance = generalBalanceQuery.data[0];

          const currentUnrestricted = parseFloat(
            generalBalance.unrestricted_qty || 0,
          );
          const currentReserved = parseFloat(generalBalance.reserved_qty || 0);
          const currentQualityInsp = parseFloat(
            generalBalance.qualityinsp_qty || 0,
          );
          const currentBlocked = parseFloat(generalBalance.block_qty || 0);
          const currentInTransit = parseFloat(
            generalBalance.intransit_qty || 0,
          );

          let newUnrestricted = currentUnrestricted;
          let newReserved = currentReserved;
          let newQualityInsp = currentQualityInsp;
          let newBlocked = currentBlocked;
          let newInTransit = currentInTransit;

          if (movementType === "OUT") {
            // Deduct from appropriate category
            switch (inventoryCategory) {
              case "Unrestricted":
                newUnrestricted = Math.max(
                  0,
                  currentUnrestricted - consolidatedQty,
                );
                break;
              case "Reserved":
                newReserved = Math.max(0, currentReserved - consolidatedQty);
                break;
              case "Quality Inspection":
                newQualityInsp = Math.max(
                  0,
                  currentQualityInsp - consolidatedQty,
                );
                break;
              case "Blocked":
                newBlocked = Math.max(0, currentBlocked - consolidatedQty);
                break;
              case "In Transit":
                newInTransit = Math.max(0, currentInTransit - consolidatedQty);
                break;
              default:
                newUnrestricted = Math.max(
                  0,
                  currentUnrestricted - consolidatedQty,
                );
            }
          } else if (movementType === "IN") {
            // Add to appropriate category
            switch (inventoryCategory) {
              case "Unrestricted":
                newUnrestricted = currentUnrestricted + consolidatedQty;
                break;
              case "Reserved":
                newReserved = currentReserved + consolidatedQty;
                break;
              case "Quality Inspection":
                newQualityInsp = currentQualityInsp + consolidatedQty;
                break;
              case "Blocked":
                newBlocked = currentBlocked + consolidatedQty;
                break;
              case "In Transit":
                newInTransit = currentInTransit + consolidatedQty;
                break;
              default:
                newUnrestricted = currentUnrestricted + consolidatedQty;
            }
          }

          const updateData = {
            unrestricted_qty: newUnrestricted,
            reserved_qty: newReserved,
            qualityinsp_qty: newQualityInsp,
            block_qty: newBlocked,
            intransit_qty: newInTransit,
            updated_at: new Date(),
          };

          // Calculate balance_quantity if it exists
          if (generalBalance.hasOwnProperty("balance_quantity")) {
            updateData.balance_quantity =
              newUnrestricted +
              newReserved +
              newQualityInsp +
              newBlocked +
              newInTransit;
          }

          await db
            .collection("item_balance")
            .doc(generalBalance.id)
            .update(updateData);

          console.log(
            `✓ Updated item_balance for serialized item ${
              matData.item_code
            } ${movementType} movement: ${inventoryCategory} qty ${
              movementType === "OUT" ? "-" : "+"
            }${consolidatedQty}`,
          );
        } else if (movementType === "IN") {
          // Create new item_balance record for IN movement
          const itemBalanceData = {
            material_id: matData.item_code,
            location_id: matData.target_location,
            unrestricted_qty:
              inventoryCategory === "Unrestricted" ? consolidatedQty : 0,
            reserved_qty:
              inventoryCategory === "Reserved" ? consolidatedQty : 0,
            qualityinsp_qty:
              inventoryCategory === "Quality Inspection" ? consolidatedQty : 0,
            block_qty: inventoryCategory === "Blocked" ? consolidatedQty : 0,
            intransit_qty:
              inventoryCategory === "In Transit" ? consolidatedQty : 0,
            plant_id: data.plant_id,
            organization_id: data.organization_id,
            material_uom: itemData.based_uom,
            created_at: new Date(),
            updated_at: new Date(),
          };

          // Calculate balance_quantity
          itemBalanceData.balance_quantity =
            itemBalanceData.unrestricted_qty +
            itemBalanceData.reserved_qty +
            itemBalanceData.qualityinsp_qty +
            itemBalanceData.block_qty +
            itemBalanceData.intransit_qty;

          await db.collection("item_balance").add(itemBalanceData);
          console.log(
            `✓ Created item_balance for serialized item ${matData.item_code} IN movement: ${inventoryCategory} qty +${consolidatedQty}`,
          );
        }
      } catch (itemBalanceError) {
        console.error(
          `Error updating item_balance for serialized item ${matData.item_code}:`,
          itemBalanceError,
        );
        throw itemBalanceError;
      }

      console.log(
        `Successfully processed consolidated movement with ${serialNumbers.length} inv_serial_movement records`,
      );
    } else {
      throw new Error(
        `Could not find created consolidated movement for ${movementType}`,
      );
    }

    console.log(
      `Successfully processed serialized item ${matData.item_code} with ${serialNumbers.length} serial numbers`,
    );
  } catch (error) {
    console.error(`Error processing serialized item movement:`, error);
    throw new Error(
      `Error processing serialized item movement: ${error.message}`,
    );
  }
};

// Helper function to process serial balance movements
const processSerialBalanceMovement = async (
  matData,
  itemData,
  serialNumber,
  movementType,
  data,
) => {
  try {
    const locationId =
      movementType === "OUT" ? matData.source_bin : matData.target_location;
    const inventoryCategory =
      movementType === "OUT"
        ? matData.source_inv_category
        : matData.target_inv_category;

    console.log(
      `Processing serial balance for ${serialNumber}, movement: ${movementType}, location: ${locationId}`,
    );

    if (movementType === "OUT") {
      // Find and update existing serial balance for OUT movement
      const serialBalanceParams = {
        material_id: matData.item_code,
        serial_number: serialNumber,
        location_id: matData.source_bin,
        plant_id: data.plant_id,
        organization_id: data.organization_id,
      };

      if (matData.batch_no) {
        serialBalanceParams.batch_id = matData.batch_no;
      }

      const existingSerialBalance = await db
        .collection("item_serial_balance")
        .where(serialBalanceParams)
        .get();

      if (existingSerialBalance.data && existingSerialBalance.data.length > 0) {
        const serialBalance = existingSerialBalance.data[0];

        // Get current quantities
        const currentUnrestricted = parseFloat(
          serialBalance.unrestricted_qty || 0,
        );
        const currentReserved = parseFloat(serialBalance.reserved_qty || 0);
        const currentQualityInsp = parseFloat(
          serialBalance.qualityinsp_qty || 0,
        );
        const currentBlocked = parseFloat(serialBalance.block_qty || 0);
        const currentInTransit = parseFloat(serialBalance.intransit_qty || 0);

        // Determine which quantity category to deduct from based on source inventory category
        let newUnrestricted = currentUnrestricted;
        let newReserved = currentReserved;
        let newQualityInsp = currentQualityInsp;
        let newBlocked = currentBlocked;
        let newInTransit = currentInTransit;

        const qtyToDeduct = 1; // Each serial is 1 unit

        switch (matData.source_inv_category) {
          case "Unrestricted":
            newUnrestricted = Math.max(0, currentUnrestricted - qtyToDeduct);
            break;
          case "Reserved":
            newReserved = Math.max(0, currentReserved - qtyToDeduct);
            break;
          case "Quality Inspection":
            newQualityInsp = Math.max(0, currentQualityInsp - qtyToDeduct);
            break;
          case "Blocked":
            newBlocked = Math.max(0, currentBlocked - qtyToDeduct);
            break;
          case "In Transit":
            newInTransit = Math.max(0, currentInTransit - qtyToDeduct);
            break;
          default:
            console.warn(
              `Unknown source inventory category: ${matData.source_inv_category}, defaulting to Unrestricted`,
            );
            newUnrestricted = Math.max(0, currentUnrestricted - qtyToDeduct);
        }

        const updateData = {
          unrestricted_qty: newUnrestricted,
          reserved_qty: newReserved,
          qualityinsp_qty: newQualityInsp,
          block_qty: newBlocked,
          intransit_qty: newInTransit,
          updated_at: new Date(),
        };

        // Calculate balance_quantity if it exists
        if (serialBalance.hasOwnProperty("balance_quantity")) {
          updateData.balance_quantity =
            newUnrestricted +
            newReserved +
            newQualityInsp +
            newBlocked +
            newInTransit;
        }

        await db
          .collection("item_serial_balance")
          .doc(serialBalance.id)
          .update(updateData);

        console.log(
          `Updated serial balance for OUT movement: ${serialNumber} - ` +
            `${matData.source_inv_category}: ${qtyToDeduct} deducted from location ${matData.source_bin}`,
        );
      } else {
        console.warn(
          `No existing serial balance found for OUT movement: ${serialNumber} at location ${matData.source_bin}`,
        );
      }
    } else if (movementType === "IN") {
      // Check if serial balance already exists at target location
      const serialBalanceParams = {
        material_id: matData.item_code,
        serial_number: serialNumber,
        location_id: matData.target_location,
        plant_id: data.plant_id,
        organization_id: data.organization_id,
      };

      if (matData.batch_no) {
        serialBalanceParams.batch_id = matData.batch_no;
      }

      const existingSerialBalance = await db
        .collection("item_serial_balance")
        .where(serialBalanceParams)
        .get();

      const qtyToAdd = 1; // Each serial is 1 unit

      if (existingSerialBalance.data && existingSerialBalance.data.length > 0) {
        // Update existing serial balance
        const serialBalance = existingSerialBalance.data[0];

        // Get current quantities
        const currentUnrestricted = parseFloat(
          serialBalance.unrestricted_qty || 0,
        );
        const currentReserved = parseFloat(serialBalance.reserved_qty || 0);
        const currentQualityInsp = parseFloat(
          serialBalance.qualityinsp_qty || 0,
        );
        const currentBlocked = parseFloat(serialBalance.block_qty || 0);
        const currentInTransit = parseFloat(serialBalance.intransit_qty || 0);

        // Determine which quantity category to add to based on target inventory category
        let newUnrestricted = currentUnrestricted;
        let newReserved = currentReserved;
        let newQualityInsp = currentQualityInsp;
        let newBlocked = currentBlocked;
        let newInTransit = currentInTransit;

        switch (matData.target_inv_category) {
          case "Unrestricted":
            newUnrestricted = currentUnrestricted + qtyToAdd;
            break;
          case "Reserved":
            newReserved = currentReserved + qtyToAdd;
            break;
          case "Quality Inspection":
            newQualityInsp = currentQualityInsp + qtyToAdd;
            break;
          case "Blocked":
            newBlocked = currentBlocked + qtyToAdd;
            break;
          case "In Transit":
            newInTransit = currentInTransit + qtyToAdd;
            break;
          default:
            console.warn(
              `Unknown target inventory category: ${matData.target_inv_category}, defaulting to Unrestricted`,
            );
            newUnrestricted = currentUnrestricted + qtyToAdd;
        }

        const updateData = {
          unrestricted_qty: newUnrestricted,
          reserved_qty: newReserved,
          qualityinsp_qty: newQualityInsp,
          block_qty: newBlocked,
          intransit_qty: newInTransit,
          inventory_category: inventoryCategory,
          updated_at: new Date(),
        };

        // Calculate balance_quantity if it exists
        if (serialBalance.hasOwnProperty("balance_quantity")) {
          updateData.balance_quantity =
            newUnrestricted +
            newReserved +
            newQualityInsp +
            newBlocked +
            newInTransit;
        }

        await db
          .collection("item_serial_balance")
          .doc(serialBalance.id)
          .update(updateData);

        console.log(
          `Updated existing serial balance for IN movement: ${serialNumber} - ` +
            `${matData.target_inv_category}: ${qtyToAdd} added to location ${matData.target_location}`,
        );
      } else {
        // Create new serial balance record
        const serialBalanceData = {
          material_id: matData.item_code,
          serial_number: serialNumber,
          location_id: matData.target_location,
          batch_id: matData.batch_no || null,
          unrestricted_qty:
            matData.target_inv_category === "Unrestricted" ? qtyToAdd : 0,
          reserved_qty:
            matData.target_inv_category === "Reserved" ? qtyToAdd : 0,
          qualityinsp_qty:
            matData.target_inv_category === "Quality Inspection" ? qtyToAdd : 0,
          block_qty: matData.target_inv_category === "Blocked" ? qtyToAdd : 0,
          intransit_qty:
            matData.target_inv_category === "In Transit" ? qtyToAdd : 0,
          inventory_category: inventoryCategory,
          plant_id: data.plant_id,
          organization_id: data.organization_id,
          material_uom: itemData.based_uom,
          created_at: new Date(),
          updated_at: new Date(),
        };

        // Calculate balance_quantity
        serialBalanceData.balance_quantity =
          serialBalanceData.unrestricted_qty +
          serialBalanceData.reserved_qty +
          serialBalanceData.qualityinsp_qty +
          serialBalanceData.block_qty +
          serialBalanceData.intransit_qty;

        await db.collection("item_serial_balance").add(serialBalanceData);
        console.log(
          `Created new serial balance for IN movement: ${serialNumber} - ` +
            `${matData.target_inv_category}: ${qtyToAdd} at location ${matData.target_location}`,
        );
      }
    }
  } catch (error) {
    console.error(
      `Error processing serial balance movement for ${serialNumber}:`,
      error,
    );
    throw error;
  }
};

const processBalanceTable = async (balanceUpdates) => {
  try {
    // Helper function to initialize new balance data
    const initializeBalanceData = (matData) => {
      console.log("Initializing new balance data", {
        material_id: matData.material_id,
        location_id: matData.location_id,
        batch_id: matData.batch_id,
      });

      const balance_quantity =
        matData.block_qty +
        matData.reserved_qty +
        matData.unrestricted_qty +
        matData.qualityinsp_qty +
        matData.intransit_qty;

      const newBalance = {
        material_id: matData.material_id,
        location_id: matData.location_id,
        block_qty: matData.block_qty,
        reserved_qty: matData.reserved_qty,
        unrestricted_qty: matData.unrestricted_qty,
        qualityinsp_qty: matData.qualityinsp_qty,
        intransit_qty: matData.intransit_qty,
        balance_quantity,
        plant_id: matData.plant_id,
        organization_id: matData.organization_id,
        material_uom: matData.material_uom || "default_uom",
      };

      if (matData.batch_id) {
        newBalance.batch_id = matData.batch_id;
      }

      console.log("New balance data initialized", newBalance);
      return newBalance;
    };

    for (const key in balanceUpdates) {
      const update = balanceUpdates[key];
      const collection =
        update.batch_id && update.batch_id !== "no_batch"
          ? "item_batch_balance"
          : "item_balance";
      const queryFields =
        collection === "item_batch_balance"
          ? {
              material_id: update.material_id,
              batch_id: update.batch_id,
              location_id: update.location_id,
            }
          : {
              material_id: update.material_id,
              location_id: update.location_id,
            };

      console.log("Querying balance record", { collection, queryFields });

      const balanceData = await db
        .collection(collection)
        .where(queryFields)
        .get();

      if (balanceData.data.length > 0) {
        const record = balanceData.data[0];
        console.log("Existing balance record found", {
          record_id: record.id,
          material_id: record.material_id,
          location_id: record.location_id,
          batch_id: record.batch_id || "none",
        });

        let block_qty = record.block_qty || 0,
          reserved_qty = record.reserved_qty || 0,
          unrestricted_qty = record.unrestricted_qty || 0,
          qualityinsp_qty = record.qualityinsp_qty || 0,
          intransit_qty = record.intransit_qty || 0;

        console.log(
          `Processing ${update.movementType} movement for balance update`,
        );
        if (update.movementType === "OUT") {
          block_qty -= update.block_qty;
          reserved_qty -= update.reserved_qty;
          unrestricted_qty -= update.unrestricted_qty;
          qualityinsp_qty -= update.qualityinsp_qty;
          intransit_qty -= update.intransit_qty;
        } else if (update.movementType === "IN") {
          block_qty += update.block_qty;
          reserved_qty += update.reserved_qty;
          unrestricted_qty += update.unrestricted_qty;
          qualityinsp_qty += update.qualityinsp_qty;
          intransit_qty += update.intransit_qty;
        }

        console.log("Updated quantities", {
          block_qty,
          reserved_qty,
          unrestricted_qty,
          qualityinsp_qty,
          intransit_qty,
        });

        const balance_quantity =
          block_qty +
          reserved_qty +
          unrestricted_qty +
          qualityinsp_qty +
          intransit_qty;

        const updatedBalance = {
          material_id: record.material_id,
          location_id: record.location_id,
          block_qty,
          reserved_qty,
          unrestricted_qty,
          qualityinsp_qty,
          intransit_qty,
          balance_quantity,
          plant_id: record.plant_id,
          organization_id: record.organization_id,
          material_uom: record.material_uom || "default_uom",
          ...(collection === "item_batch_balance" && {
            batch_id: record.batch_id,
          }),
        };

        console.log("Updating existing balance record", updatedBalance);
        await db.collection(collection).doc(record.id).update(updatedBalance);
        console.log("Balance record updated successfully");

        // ✅ CRITICAL FIX: For batched items, also update item_balance (aggregated across all batches)
        if (collection === "item_batch_balance") {
          try {
            const generalItemBalanceParams = {
              material_id: update.material_id,
              location_id: update.location_id,
              plant_id: update.plant_id,
              organization_id: update.organization_id,
            };
            // Don't include batch_id in item_balance query (aggregated balance across all batches)

            const generalBalanceQuery = await db
              .collection("item_balance")
              .where(generalItemBalanceParams)
              .get();

            if (
              generalBalanceQuery.data &&
              generalBalanceQuery.data.length > 0
            ) {
              // Update existing item_balance
              const generalBalance = generalBalanceQuery.data[0];

              const currentUnrestricted = parseFloat(
                generalBalance.unrestricted_qty || 0,
              );
              const currentReserved = parseFloat(
                generalBalance.reserved_qty || 0,
              );
              const currentQualityInsp = parseFloat(
                generalBalance.qualityinsp_qty || 0,
              );
              const currentBlocked = parseFloat(generalBalance.block_qty || 0);
              const currentInTransit = parseFloat(
                generalBalance.intransit_qty || 0,
              );

              let newUnrestricted = currentUnrestricted;
              let newReserved = currentReserved;
              let newQualityInsp = currentQualityInsp;
              let newBlocked = currentBlocked;
              let newInTransit = currentInTransit;

              if (update.movementType === "OUT") {
                // Deduct from item_balance
                newUnrestricted = Math.max(
                  0,
                  currentUnrestricted - update.unrestricted_qty,
                );
                newReserved = Math.max(
                  0,
                  currentReserved - update.reserved_qty,
                );
                newQualityInsp = Math.max(
                  0,
                  currentQualityInsp - update.qualityinsp_qty,
                );
                newBlocked = Math.max(0, currentBlocked - update.block_qty);
                newInTransit = Math.max(
                  0,
                  currentInTransit - update.intransit_qty,
                );
              } else if (update.movementType === "IN") {
                // Add to item_balance
                newUnrestricted = currentUnrestricted + update.unrestricted_qty;
                newReserved = currentReserved + update.reserved_qty;
                newQualityInsp = currentQualityInsp + update.qualityinsp_qty;
                newBlocked = currentBlocked + update.block_qty;
                newInTransit = currentInTransit + update.intransit_qty;
              }

              const generalUpdateData = {
                unrestricted_qty: newUnrestricted,
                reserved_qty: newReserved,
                qualityinsp_qty: newQualityInsp,
                block_qty: newBlocked,
                intransit_qty: newInTransit,
                updated_at: new Date(),
              };

              // Calculate balance_quantity if it exists
              if (generalBalance.hasOwnProperty("balance_quantity")) {
                generalUpdateData.balance_quantity =
                  newUnrestricted +
                  newReserved +
                  newQualityInsp +
                  newBlocked +
                  newInTransit;
              }

              await db
                .collection("item_balance")
                .doc(generalBalance.id)
                .update(generalUpdateData);

              console.log(
                `✓ Updated item_balance for batch item ${update.material_id} ${update.movementType} movement at location ${update.location_id}`,
              );
            } else if (update.movementType === "IN") {
              // Create new item_balance record for IN movement
              const itemBalanceData = {
                material_id: update.material_id,
                location_id: update.location_id,
                unrestricted_qty: update.unrestricted_qty,
                reserved_qty: update.reserved_qty,
                qualityinsp_qty: update.qualityinsp_qty,
                block_qty: update.block_qty,
                intransit_qty: update.intransit_qty,
                plant_id: update.plant_id,
                organization_id: update.organization_id,
                material_uom: update.material_uom,
                created_at: new Date(),
                updated_at: new Date(),
              };

              // Calculate balance_quantity
              itemBalanceData.balance_quantity =
                itemBalanceData.unrestricted_qty +
                itemBalanceData.reserved_qty +
                itemBalanceData.qualityinsp_qty +
                itemBalanceData.block_qty +
                itemBalanceData.intransit_qty;

              await db.collection("item_balance").add(itemBalanceData);
              console.log(
                `✓ Created item_balance for batch item ${update.material_id} IN movement at location ${update.location_id}`,
              );
            }
          } catch (itemBalanceError) {
            console.error(
              `Error updating item_balance for batch item ${update.material_id}:`,
              itemBalanceError,
            );
            throw itemBalanceError;
          }
        }
      } else if (update.movementType === "IN") {
        console.log(
          "No existing balance record found for IN movement, creating new",
        );
        const newBalance = await initializeBalanceData(update);
        if (collection === "item_batch_balance") {
          newBalance.batch_id = update.batch_id;
          console.log("Added batch_id to new balance", {
            batch_id: update.batch_id,
          });
        }
        await db.collection(collection).add(newBalance);
        console.log("New balance record created successfully");
      }
    }
  } catch (error) {
    throw new Error(error);
  }
};

const processInventoryMovementandBalanceTable = async (
  toData,
  updatedItems,
) => {
  try {
    const balanceUpdates = {};

    // Helper function for UOM conversion (reused from processBalanceTable)
    const convertUOM = async (quantity, itemData, matData) => {
      console.log("Converting UOM", {
        item_code: matData.item_code,
        quantity,
        item_uom: matData.item_uom,
        based_uom: itemData.based_uom,
      });

      if (matData.item_uom !== itemData.based_uom) {
        for (const uom of itemData.table_uom_conversion) {
          if (matData.item_uom === uom.alt_uom_id) {
            const convertedQty = roundQty(quantity * uom.base_qty);
            console.log("UOM conversion applied", {
              convertedQty,
              conversion_factor: uom.base_qty,
            });
            return convertedQty;
          }
        }
      }
      const roundedQty = roundQty(quantity);
      console.log("No UOM conversion needed", { roundedQty });
      return roundedQty;
    };

    for (const mat of updatedItems) {
      if (mat.is_split === "Yes") {
        continue;
      } else {
        if (mat.item_code) {
          if (mat.putaway_qty > 0) {
            console.log("Processing item", {
              item_code: mat.item_code,
              line_index: mat.line_index,
              putaway_qty: mat.putaway_qty,
              source_bin: mat.source_bin,
              target_location: mat.target_location,
              batch_no: mat.batch_no,
            });

            const resItem = await db
              .collection("Item")
              .where({ id: mat.item_code, is_deleted: 0 })
              .get();

            if (resItem && resItem.data.length > 0) {
              const itemData = resItem.data[0];
              console.log("item", itemData);

              // Check if this is a serialized item
              const isSerializedItem =
                mat.is_serialized_item === 1 &&
                mat.select_serial_number &&
                Array.isArray(mat.select_serial_number);

              if (isSerializedItem) {
                console.log(
                  `Processing serialized item: ${mat.item_code} with ${mat.select_serial_number.length} serial numbers`,
                );

                // Validate that putaway_qty matches serial number count
                const trimmedSerialNumbers = mat.select_serial_number
                  .map((sn) => sn.trim())
                  .filter((sn) => sn !== "");

                if (trimmedSerialNumbers.length !== mat.putaway_qty) {
                  console.warn(
                    `Serial number count (${trimmedSerialNumbers.length}) doesn't match putaway quantity (${mat.putaway_qty}) for item ${mat.item_code}`,
                  );
                }

                // Process serialized item movements
                await processSerializedItemMovement(
                  toData,
                  itemData,
                  mat,
                  "OUT",
                  trimmedSerialNumbers,
                );
                await processSerializedItemMovement(
                  toData,
                  itemData,
                  mat,
                  "IN",
                  trimmedSerialNumbers,
                );

                console.log(
                  `Successfully processed serialized item ${
                    mat.item_code
                  } with serial numbers: [${trimmedSerialNumbers.join(", ")}]`,
                );
              } else {
                // Process non-serialized items as before
                await addInventoryMovementData(toData, "OUT", itemData, mat);
                await addInventoryMovementData(toData, "IN", itemData, mat);
              }

              // Skip regular balance processing for serialized items as they are handled in serial balance
              if (!isSerializedItem) {
                const baseQty = await convertUOM(
                  mat.putaway_qty,
                  itemData,
                  mat,
                );

                // Initialize category quantities
                const outCategories = {
                  block_qty:
                    mat.source_inv_category === "Blocked" ? baseQty : 0,
                  reserved_qty:
                    mat.source_inv_category === "Reserved" ? baseQty : 0,
                  unrestricted_qty:
                    mat.source_inv_category === "Unrestricted" ? baseQty : 0,
                  qualityinsp_qty:
                    mat.source_inv_category === "Quality Inspection"
                      ? baseQty
                      : 0,
                  intransit_qty:
                    mat.source_inv_category === "In Transit" ? baseQty : 0,
                };

                const inCategories = {
                  block_qty:
                    mat.target_inv_category === "Blocked" ? baseQty : 0,
                  reserved_qty:
                    mat.target_inv_category === "Reserved" ? baseQty : 0,
                  unrestricted_qty:
                    mat.target_inv_category === "Unrestricted" ? baseQty : 0,
                  qualityinsp_qty:
                    mat.target_inv_category === "Quality Inspection"
                      ? baseQty
                      : 0,
                  intransit_qty:
                    mat.target_inv_category === "In Transit" ? baseQty : 0,
                };
                // OUT movement aggregation (source_bin)
                const outKey =
                  itemData.item_batch_management === 1
                    ? `${mat.item_code}_${mat.source_bin}_${
                        mat.batch_no || "no_batch"
                      }`
                    : `${mat.item_code}_${mat.source_bin}`;

                if (!balanceUpdates[outKey]) {
                  balanceUpdates[outKey] = {
                    material_id: mat.item_code,
                    location_id: mat.source_bin,
                    batch_id: mat.batch_no || "",
                    block_qty: 0,
                    reserved_qty: 0,
                    unrestricted_qty: 0,
                    qualityinsp_qty: 0,
                    intransit_qty: 0,
                    movementType: "OUT",
                    material_uom: itemData.based_uom,
                    plant_id: toData.plant_id,
                    organization_id: toData.organization_id,
                  };
                }

                balanceUpdates[outKey].block_qty += outCategories.block_qty;
                balanceUpdates[outKey].reserved_qty +=
                  outCategories.reserved_qty;
                balanceUpdates[outKey].unrestricted_qty +=
                  outCategories.unrestricted_qty;
                balanceUpdates[outKey].qualityinsp_qty +=
                  outCategories.qualityinsp_qty;
                balanceUpdates[outKey].intransit_qty +=
                  outCategories.intransit_qty;

                console.log("Aggregated OUT quantities", {
                  key: outKey,
                  block_qty: balanceUpdates[outKey].block_qty,
                  reserved_qty: balanceUpdates[outKey].reserved_qty,
                  unrestricted_qty: balanceUpdates[outKey].unrestricted_qty,
                  qualityinsp_qty: balanceUpdates[outKey].qualityinsp_qty,
                  intransit_qty: balanceUpdates[outKey].intransit_qty,
                  inv_category: mat.source_inv_category,
                });
                // IN movement aggregation (target_location)
                const inKey =
                  itemData.item_batch_management === 1
                    ? `${mat.item_code}_${mat.target_location}_${
                        mat.batch_no || "no_batch"
                      }`
                    : `${mat.item_code}_${mat.target_location}`;

                if (!balanceUpdates[inKey]) {
                  balanceUpdates[inKey] = {
                    material_id: mat.item_code,
                    location_id: mat.target_location,
                    batch_id: mat.batch_no || "",
                    block_qty: 0,
                    reserved_qty: 0,
                    unrestricted_qty: 0,
                    qualityinsp_qty: 0,
                    intransit_qty: 0,
                    movementType: "IN",
                    plant_id: toData.plant_id,
                    material_uom: itemData.based_uom,
                    organization_id: toData.organization_id,
                  };
                }

                balanceUpdates[inKey].block_qty += inCategories.block_qty;
                balanceUpdates[inKey].reserved_qty += inCategories.reserved_qty;
                balanceUpdates[inKey].unrestricted_qty +=
                  inCategories.unrestricted_qty;
                balanceUpdates[inKey].qualityinsp_qty +=
                  inCategories.qualityinsp_qty;
                balanceUpdates[inKey].intransit_qty +=
                  inCategories.intransit_qty;

                console.log("Aggregated IN quantities", {
                  key: inKey,
                  block_qty: balanceUpdates[inKey].block_qty,
                  reserved_qty: balanceUpdates[inKey].reserved_qty,
                  unrestricted_qty: balanceUpdates[inKey].unrestricted_qty,
                  qualityinsp_qty: balanceUpdates[inKey].qualityinsp_qty,
                  intransit_qty: balanceUpdates[inKey].intransit_qty,
                  inv_category: mat.target_inv_category,
                });
              } // Close the if (!isSerializedItem) block
            }
          }
        }
      }
    }

    await processBalanceTable(balanceUpdates);
  } catch {
    throw new Error("Error in creating inventory movement.");
  }
};

// Main execution wrapped in an async IIFE
(async () => {
  try {
    this.showLoading();
    const data = await this.getValues();
    const page_status = data.page_status;
    const originalToStatus = data.to_status;

    // Define required fields
    const requiredFields = [
      { name: "plant_id", label: "Plant" },
      { name: "to_id", label: "Transfer Order No" },
      { name: "movement_type", label: "Movement Type" },
      { name: "ref_doc_type", label: "Reference Document Type" },
      { name: "gr_no", label: "Reference Document No" },
      {
        name: "table_putaway_item",
        label: "Putaway Items",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    await this.validate("to_id");

    // Validate items
    const missingFields = validateForm(data, requiredFields);

    for (const [index, item] of data.table_putaway_item.entries()) {
      await this.validate(`table_putaway_item.${index}.putaway_qty`);

      // Check target location for non split / child item
      if (item.is_split === "No" && item.putaway_qty > 0) {
        if (
          !item.target_location ||
          item.target_location === null ||
          item.target_location === ""
        ) {
          missingFields.push(
            `Target Location (in Putaway Items #${index + 1})`,
          );
        }
      }
    }

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

    // Validate quantities and update line statuses
    const { updatedItems, errors } = validateAndUpdateLineStatuses(
      data.table_putaway_item,
    );

    if (errors.length > 0) {
      this.hideLoading();
      this.$message.error(errors.join("; "));
      return;
    }

    // Update the form data with the new line statuses and serial numbers (only if we proceed)
    for (let index = 0; index < updatedItems.length; index++) {
      this.setData({
        [`table_putaway_item.${index}.line_status`]:
          updatedItems[index].line_status,
      });

      // Update pending process quantity
      this.setData({
        [`table_putaway_item.${index}.pending_process_qty`]:
          updatedItems[index].pending_process_qty,
      });

      // Update serial numbers for serialized items (including split scenarios)
      if (updatedItems[index].is_serialized_item === 1) {
        this.setData({
          [`table_putaway_item.${index}.serial_numbers`]:
            updatedItems[index].serial_numbers,
        });

        // For parent items in split scenarios, also update their serial numbers
        // This ensures the parent item shows the correct leftover serial numbers
        if (
          updatedItems[index].parent_or_child === "Parent" &&
          updatedItems[index].is_split === "Yes"
        ) {
          console.log(
            `Updated parent item ${updatedItems[index].item_code} serial numbers in form: "${updatedItems[index].serial_numbers}"`,
          );
        }
      }
    }

    const latestPutawayItems = updatedItems
      .filter((item) => item.parent_or_child === "Parent")
      .map((item) => ({ ...item })); // Shallow copy each object

    for (const putaway of latestPutawayItems) {
      putaway.is_split = "No";
      putaway.target_location = "";
      putaway.remark = "";
      putaway.putaway_qty = 0;
    }

    console.log("updatedItems", updatedItems);

    const newTransferOrderStatus = "In Progress";

    // Prepare transfer order object
    const toData = {
      to_status: newTransferOrderStatus,
      plant_id: data.plant_id,
      to_id: data.to_id,
      movement_type: data.movement_type,
      ref_doc_type: data.ref_doc_type,
      gr_no: data.gr_no,
      receiving_no: data.receiving_no,
      assigned_to: data.assigned_to,
      supplier_id: data.supplier_id,
      created_by: data.created_by,
      created_at: data.created_at,
      organization_id: organizationId,
      ref_doc: data.ref_doc,
      quality_insp_no: data.quality_insp_no,
      table_putaway_item: latestPutawayItems,
      table_putaway_records: data.table_putaway_records,
      remarks: data.remarks,
      qi_id: data.qi_id,
    };

    await createPutawayRecords(toData, updatedItems);

    // Clean up undefined/null values
    Object.keys(toData).forEach((key) => {
      if (toData[key] === undefined || toData[key] === null) {
        delete toData[key];
      }
    });

    let toId;

    // Perform action based on page status
    if (page_status === "Add") {
      await addEntry(organizationId, toData);
      await processInventoryMovementandBalanceTable(toData, updatedItems);
      await updateGoodsReceivingPutawayStatus(data.gr_no);
    } else if (page_status === "Edit") {
      toId = data.id;
      await updateEntry(organizationId, toData, toId, originalToStatus);
      await processInventoryMovementandBalanceTable(toData, updatedItems);
      await updateGoodsReceivingPutawayStatus(data.gr_no);
    }

    // Success message with status information
    const statusMessage =
      newTransferOrderStatus !== originalToStatus
        ? ` (Status updated to: ${newTransferOrderStatus})`
        : "";

    this.$message.success(
      `${
        page_status === "Add" ? "Added" : "Updated"
      } successfully${statusMessage}`,
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
