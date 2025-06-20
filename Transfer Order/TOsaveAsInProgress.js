const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const getPrefixData = async (
  organizationId,
  documentType = "Transfer Order"
) => {
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
  documentType = "Transfer Order"
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
  collection = "transfer_order",
  prefix = "to_id"
) => {
  const existingDoc = await db
    .collection(collection)
    .where({ [prefix]: generatedPrefix, organization_id: organizationId })
    .get();

  return !existingDoc.data || existingDoc.data.length === 0;
};

const findUniquePrefix = async (
  prefixData,
  organizationId,
  collection = "transfer_order",
  prefix = "to_id"
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
      "Could not generate a unique Transfer Order number after maximum attempts"
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
const validateAndUpdateLineStatuses = (pickingItems) => {
  const errors = [];
  const updatedItems = JSON.parse(JSON.stringify(pickingItems));

  for (let index = 0; index < updatedItems.length; index++) {
    const item = updatedItems[index];

    // Safely parse quantities
    let pendingProcessQty = parseFloat(item.pending_process_qty) || 0;
    const pickedQty = parseFloat(item.picked_qty) || 0;

    console.log(
      `Item ${
        item.item_id || index
      }: pendingProcessQty=${pendingProcessQty}, pickedQty=${pickedQty}`
    );

    // Validation checks
    if (pickedQty < 0) {
      errors.push(
        `Picked quantity cannot be negative for item ${
          item.item_id || `#${index + 1}`
        }`
      );
      continue;
    }

    if (pickedQty > pendingProcessQty) {
      errors.push(
        `Picked quantity (${pickedQty}) cannot be greater than quantity to pick (${pendingProcessQty}) for item ${
          item.item_id || `#${index + 1}`
        }`
      );
      continue;
    }

    // Determine line status based on quantities
    let lineStatus;
    if (pickedQty === 0) {
      lineStatus = null;
    } else if (pickedQty === pendingProcessQty) {
      lineStatus = "Completed";
    } else if (pickedQty < pendingProcessQty) {
      lineStatus = "In Progress";
    }

    // Calculate pending process quantity
    pendingProcessQty -= pickedQty;

    // Update line status
    updatedItems[index].line_status = lineStatus;
    updatedItems[index].pending_process_qty = pendingProcessQty;
    console.log(`Item ${item.item_id || index} line status: ${lineStatus}`);
  }

  return { updatedItems, errors };
};

const addEntry = async (organizationId, toData) => {
  try {
    const prefixData = await getPrefixData(organizationId, "Transfer Order");

    if (prefixData) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId,
        "transfer_order",
        "to_id"
      );

      await updatePrefix(organizationId, runningNumber, "Transfer Order");
      toData.to_id = prefixToShow;
    }

    // Add the record
    await db.collection("transfer_order").add(toData);

    // Fetch the created record to get its ID
    const createdRecord = await db
      .collection("transfer_order")
      .where({
        to_id: toData.to_id,
        organization_id: organizationId,
      })
      .get();

    if (!createdRecord.data || createdRecord.data.length === 0) {
      throw new Error("Failed to retrieve created transfer order record");
    }

    const toId = createdRecord.data[0].id;
    console.log("Transfer order created successfully with ID:", toId);

    // Process balance table with the created record
    await processBalanceTable(toData, false);

    return toId; // Return the created ID
  } catch (error) {
    console.error("Error in addEntry:", error);
    throw error;
  }
};

const updateEntry = async (organizationId, toData, toId, originalToStatus) => {
  try {
    let oldToId = toData.to_id;

    if (originalToStatus === "Draft") {
      const prefixData = await getPrefixData(organizationId, "Transfer Order");

      if (prefixData) {
        const { prefixToShow, runningNumber } = await findUniquePrefix(
          prefixData,
          organizationId,
          "transfer_order",
          "to_id"
        );

        await updatePrefix(organizationId, runningNumber, "Transfer Order");
        toData.to_id = prefixToShow;
      }
    }

    await db.collection("transfer_order").doc(toId).update(toData);
    await processBalanceTable(toData, true, oldToId, originalToStatus);

    console.log("Transfer order updated successfully");
    return toId;
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

const updateGoodsDeliveryPickingStatus = async (gdId) => {
  try {
    const gd = await db.collection("goods_delivery").doc(gdId).get();
    const gdData = gd.data();
    const pickingStatus = gdData.picking_status;

    if (pickingStatus === "Completed") {
      this.$message.error("Goods Delivery is already completed");
      return;
    }

    const newPickingStatus = "In Progress";
    await db.collection("goods_delivery").doc(gdId).update({
      picking_status: newPickingStatus,
    });

    this.$message.success("Goods Delivery picking status updated successfully");
  } catch (error) {
    this.$message.error("Error updating Goods Delivery picking status");
    console.error("Error flipping Goods Delivery picking status:", error);
  }
};

const createPickingRecord = async (toData) => {
  const pickingRecords = [];
  for (const item of toData.table_picking_items) {
    if (item.picked_qty > 0) {
      const pickingRecord = {
        item_id: item.item_id,
        item_name: item.item_name,
        item_desc: item.item_desc,
        batch_no: item.batch_no,
        store_out_qty: item.picked_qty,
        source_bin: item.source_bin,
        remark: item.remark,
        confirmed_by: this.getVarGlobal("nickname"),
        confirmed_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      };
      pickingRecords.push(pickingRecord);
    }
  }

  toData.table_picking_records = pickingRecords;
};

// Main execution wrapped in an async IIFE
(async () => {
  try {
    this.showLoading();
    const data = await this.getValues();
    const page_status = data.page_status;
    const originalToStatus = data.to_status;

    console.log(
      `Page Status: ${page_status}, Original TO Status: ${originalToStatus}`
    );

    // Define required fields
    const requiredFields = [
      { name: "plant_id", label: "Plant" },
      { name: "to_id", label: "Transfer Order No" },
      { name: "movement_type", label: "Movement Type" },
      { name: "ref_doc_type", label: "Reference Document Type" },
      { name: "gd_no", label: "Reference Document No" },
      {
        name: "table_picking_items",
        label: "Picking Items",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    // Validate items
    for (const [index, item] of data.table_picking_items.entries()) {
      await this.validate(`table_picking_items.${index}.picked_qty`);
    }

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

    // Validate quantities and update line statuses
    const { updatedItems, errors } = validateAndUpdateLineStatuses(
      data.table_picking_items
    );

    if (errors.length > 0) {
      this.hideLoading();
      this.$message.error(errors.join("; "));
      return;
    }

    // Update the form data with the new line statuses (only if we proceed)
    for (let index = 0; index < updatedItems.length; index++) {
      this.setData({
        [`table_picking_items.${index}.line_status`]:
          updatedItems[index].line_status,
      });
    }

    const newTransferOrderStatus = "In Progress";

    // Prepare transfer order object
    const toData = {
      to_status: newTransferOrderStatus,
      plant_id: data.plant_id,
      to_id: data.to_id,
      movement_type: data.movement_type,
      ref_doc_type: data.ref_doc_type,
      gd_no: data.gd_no,
      assigned_to: data.assigned_to,
      created_by: data.created_by,
      created_at: data.created_at,
      organization_id: organizationId,
      ref_doc: data.ref_doc,
      table_picking_items: updatedItems,
      table_picking_records: data.table_picking_records,
    };

    await createPickingRecord(toData);

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
      await updateGoodsDeliveryPickingStatus(data.gd_no);
    } else if (page_status === "Edit") {
      toId = data.id;
      await updateEntry(organizationId, toData, toId, originalToStatus);
      await updateGoodsDeliveryPickingStatus(data.gd_no);
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
