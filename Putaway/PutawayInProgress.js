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
    runningNumber
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
      "Could not generate a unique Putaway number after maximum attempts"
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

const validateField = (value, field) => {
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
      }: qtyToPutaway=${qtyToPutaway}, pendingProcessQty=${pendingProcessQty}, putawayQty=${putawayQty}`
    );

    // Validation checks
    if (putawayQty < 0) {
      errors.push(
        `Putaway quantity cannot be negative for item ${
          item.item_code || `#${index + 1}`
        }`
      );
      return null;
    }

    if (putawayQty > pendingProcessQty) {
      errors.push(
        `Putaway quantity (${putawayQty}) cannot be greater than quantity to putaway (${pendingProcessQty}) for item ${
          item.item_code || `#${index + 1}`
        }`
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
    console.log(`Item ${item.item_code || index} line status: ${lineStatus}`);

    return lineStatus;
  };

  // Process all items first
  const itemStatusMap = new Map();
  for (let index = 0; index < updatedItems.length; index++) {
    const item = updatedItems[index];
    if (item.is_split === "No") {
      // Process child items or standalone items
      const status = updateItemStatus(item, index);
      itemStatusMap.set(item.item_code, status);
    }
  }

  // Process parent items
  for (let index = 0; index < updatedItems.length; index++) {
    const item = updatedItems[index];
    if (item.is_split === "Yes") {
      // Check if all child items are completed
      const childItems = updatedItems.filter(
        (child) =>
          child.parent_index === index && child.parent_or_child === "Child"
      );

      // Calculate parent's pending_process_qty as the sum of child items' pending_process_qty
      const parentPendingProcessQty = childItems.reduce(
        (sum, child) => sum + (parseFloat(child.pending_process_qty) || 0),
        0
      );

      const allChildrenCompleted = childItems.every(
        (child) => itemStatusMap.get(child.item_code) === "Completed"
      );

      // Update parent status
      item.line_status = allChildrenCompleted ? "Completed" : "In Progress";
      item.pending_process_qty = parentPendingProcessQty;

      console.log(
        `Parent Item ${item.item_code || index} line status: ${
          item.line_status
        }`
      );
    }
  }

  return { updatedItems, errors };
};

const addEntry = async (organizationId, toData) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId
      );

      await updatePrefix(organizationId, runningNumber);
      toData.to_id = prefixToShow;
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
          organizationId
        );

        await updatePrefix(organizationId, runningNumber);
        toData.to_id = prefixToShow;
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
      "Goods Receiving putaway status updated successfully"
    );
  } catch (error) {
    this.$message.error("Error updating Goods Receiving putaway status");
    console.error("Error flipping Goods Receiving putaway status:", error);
  }
};

const createPutawayRecords = async (toData, tablePutawayItem) => {
  const putawayRecords = [];
  for (const item of tablePutawayItem) {
    if (item.is_split === "Yes") {
      continue;
    }

    if (item.putaway_qty > 0) {
      const putawayRecord = {
        line_index: item.line_index,
        item_code: item.item_code,
        item_name: item.item_name,
        item_desc: item.item_desc,
        batch_no: item.batch_no,
        inv_category: item.inv_category,
        store_in_qty: item.putaway_qty,
        item_uom: item.item_uom,
        target_location: item.target_location,
        remark: item.remark,
        confirmed_by: this.getVarGlobal("nickname"),
        confirmed_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      };

      putawayRecords.push(putawayRecord);
    }
  }

  toData.table_putaway_records =
    toData.table_putaway_records.concat(putawayRecords);
};

const addInventoryMovementData = async (
  data,
  invCategory,
  movementType,
  itemData,
  matData
) => {
  try {
    let basedQty = 0;

    if (matData.item_uom !== itemData.based_uom) {
      for (const uom of itemData.table_uom_conversion) {
        if (matData.item_uom === uom.alt_uom_id) {
          basedQty = roundQty(matData.putaway_qty * uom.base_qty);
          console.log("basedQty", basedQty);
        }
      }
    } else if (matData.item_uom === itemData.based_uom) {
      basedQty = roundQty(matData.putaway_qty);
    }

    const inventoryMovementData = {
      transaction_type: "TO - PA",
      trx_no: data.to_id,
      inventory_category: invCategory,
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
  } catch (error) {
    throw new Error("Error occurred in inventory movement.");
  }
};

const processBalanceTable = async (itemData, matData, data) => {
  try {
    // Helper function for converting item UOM
    const convertUOM = async (quantity, itemData, matData) => {
      if (matData.item_uom !== itemData.based_uom) {
        for (const uom of itemData.table_uom_conversion) {
          if (matData.item_uom === uom.alt_uom_id) {
            return roundQty(quantity * uom.base_qty);
          }
        }
      }
      return roundQty(quantity);
    };

    // Helper function for calculating latest balance quantities
    const calculateBalanceQuantity = async (
      balanceData,
      matData,
      itemData,
      movementType
    ) => {
      let block_qty = 0,
        reserved_qty = 0,
        unrestricted_qty = 0,
        qualityinsp_qty = 0,
        intransit_qty = 0;

      const baseQty = await convertUOM(matData.putaway_qty, itemData, matData);

      if (matData.inv_category === "Blocked") {
        block_qty =
          movementType === "OUT"
            ? balanceData.block_qty - baseQty
            : balanceData.block_qty + baseQty;
      } else if (matData.inv_category === "Reserved") {
        reserved_qty =
          movementType === "OUT"
            ? balanceData.reserved_qty - baseQty
            : balanceData.reserved_qty + baseQty;
      } else if (matData.inv_category === "Unrestricted") {
        unrestricted_qty =
          movementType === "OUT"
            ? balanceData.unrestricted_qty - baseQty
            : balanceData.unrestricted_qty + baseQty;
      } else if (matData.inv_category === "Quality Inspection") {
        qualityinsp_qty =
          movementType === "OUT"
            ? balanceData.qualityinsp_qty - baseQty
            : balanceData.qualityinsp_qty + baseQty;
      } else if (matData.inv_category === "In Transit") {
        intransit_qty =
          movementType === "OUT"
            ? balanceData.intransit_qty - baseQty
            : balanceData.intransit_qty + baseQty;
      } else {
        unrestricted_qty =
          movementType === "OUT"
            ? balanceData.unrestricted_qty - baseQty
            : balanceData.unrestricted_qty + baseQty;
      }

      const balance_quantity =
        block_qty +
        reserved_qty +
        unrestricted_qty +
        qualityinsp_qty +
        intransit_qty;

      return {
        block_qty,
        reserved_qty,
        unrestricted_qty,
        qualityinsp_qty,
        intransit_qty,
        balance_quantity,
      };
    };

    // Helper function to initialize new balance data for IN movement when no record exists
    const initializeBalanceData = (matData, itemData, data) => {
      let block_qty = 0,
        reserved_qty = 0,
        unrestricted_qty = 0,
        qualityinsp_qty = 0,
        intransit_qty = 0;

      switch (matData.inv_category) {
        case "Blocked":
          block_qty = matData.putaway_qty;
          break;
        case "Reserved":
          reserved_qty = matData.putaway_qty;
          break;
        case "Unrestricted":
          unrestricted_qty = matData.putaway_qty;
          break;
        case "Quality Inspection":
          qualityinsp_qty = matData.putaway_qty;
          break;
        case "In Transit":
          intransit_qty = matData.putaway_qty;
          break;
        default:
          unrestricted_qty = matData.putaway_qty;
          break;
      }

      const balance_quantity =
        block_qty +
        reserved_qty +
        unrestricted_qty +
        qualityinsp_qty +
        intransit_qty;

      return {
        material_id: matData.item_code,
        location_id: matData.target_location,
        block_qty,
        reserved_qty,
        unrestricted_qty,
        qualityinsp_qty,
        balance_quantity,
        plant_id: data.plant_id,
        organization_id: data.organization_id,
        intransit_qty,
        material_uom: itemData.based_uom,
      };
    };

    // Helper function to update or create balance data
    const updateBalance = async (
      collection,
      balanceData,
      matData,
      itemData,
      data,
      movementType,
      includeBatch = false
    ) => {
      if (balanceData && balanceData.data.length > 0) {
        const record = balanceData.data[0];
        const {
          block_qty,
          reserved_qty,
          unrestricted_qty,
          qualityinsp_qty,
          intransit_qty,
          balance_quantity,
        } = await calculateBalanceQuantity(
          record,
          matData,
          itemData,
          movementType
        );

        const updatedBalance = {
          material_id: record.material_id,
          location_id: record.location_id,
          block_qty,
          reserved_qty,
          unrestricted_qty,
          qualityinsp_qty,
          balance_quantity,
          plant_id: record.plant_id,
          organization_id: record.organization_id,
          intransit_qty,
          material_uom: itemData.based_uom,
          ...(includeBatch && { batch_id: record.batch_id }),
        };

        await db.collection(collection).doc(record.id).update(updatedBalance);
      } else if (movementType === "IN") {
        const newBalance = initializeBalanceData(matData, itemData, data);
        if (includeBatch) {
          newBalance.batch_id = matData.batch_no;
        }
        await db.collection(collection).add(newBalance);
      }
    };

    // Process balance updates based on batch management
    const collection =
      itemData.item_batch_management === 1
        ? "item_batch_balance"
        : "item_balance";
    const queryFields =
      itemData.item_batch_management === 1
        ? { material_id: matData.item_code, batch_id: matData.batch_no }
        : { material_id: matData.item_code };

    // Fetch balance data for source and target locations
    const [outBalance, inBalance] = await Promise.all([
      db
        .collection(collection)
        .where({ ...queryFields, location_id: matData.source_bin })
        .get(),
      db
        .collection(collection)
        .where({ ...queryFields, location_id: matData.target_location })
        .get(),
    ]);

    // Update balance for OUT movement (source bin)
    await updateBalance(
      collection,
      outBalance,
      matData,
      itemData,
      data,
      "OUT",
      itemData.item_batch_management === 1
    );

    // Update balance for IN movement (target location)
    await updateBalance(
      collection,
      inBalance,
      matData,
      itemData,
      data,
      "IN",
      itemData.item_batch_management === 1
    );
  } catch (error) {
    throw new Error(error);
  }
};

const processInventoryMovementandBalanceTable = async (
  toData,
  updatedItems
) => {
  try {
    for (const mat of updatedItems) {
      if (mat.is_split === "Yes") {
        continue;
      } else {
        if (mat.item_code) {
          if (mat.putaway_qty > 0) {
            const resItem = await db
              .collection("Item")
              .where({ id: mat.item_code, is_deleted: 0 })
              .get();

            if (resItem && resItem.data.length > 0) {
              const itemData = resItem.data[0];
              console.log("item", itemData);
              await addInventoryMovementData(
                toData,
                mat.inv_category,
                "OUT",
                itemData,
                mat
              );
              await addInventoryMovementData(
                toData,
                mat.inv_category,
                "IN",
                itemData,
                mat
              );

              await processBalanceTable(itemData, mat, toData);
            }
          }
        }
      }
    }
  } catch (error) {
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
      if (item.is_split === "No") {
        if (
          !item.target_location ||
          item.target_location === null ||
          item.target_location === ""
        ) {
          missingFields.push(
            `Target Location (in Putaway Items #${index + 1})`
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
      data.table_putaway_item
    );

    if (errors.length > 0) {
      this.hideLoading();
      this.$message.error(errors.join("; "));
      return;
    }

    // Update the form data with the new line statuses (only if we proceed)
    for (let index = 0; index < updatedItems.length; index++) {
      this.setData({
        [`table_putaway_item.${index}.line_status`]:
          updatedItems[index].line_status,
      });
    }

    const latestPutawayItems = updatedItems
      .filter((item) => item.parent_or_child === "Parent")
      .map((item) => ({ ...item })); // Shallow copy each object

    for (const putaway of latestPutawayItems) {
      putaway.is_split = "No";
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
      } successfully${statusMessage}`
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
