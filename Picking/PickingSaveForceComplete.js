const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
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

// Helper function to calculate leftover serial numbers after partial processing
const calculateLeftoverSerialNumbers = (item) => {
  // Only process serialized items
  if (item.is_serialized_item !== 1) {
    return item.serial_numbers; // Return original if not serialized
  }

  // Get the original serial numbers and processed serial numbers
  const originalSerialNumbers = item.serial_numbers
    ? item.serial_numbers
        .split(",")
        .map((sn) => sn.trim())
        .filter((sn) => sn !== "")
    : [];

  const processedSerialNumbers = Array.isArray(item.select_serial_number)
    ? item.select_serial_number.map((sn) => sn.trim()).filter((sn) => sn !== "")
    : [];

  console.log(
    `Item ${
      item.item_code || item.item_id
    }: Original serial numbers: [${originalSerialNumbers.join(", ")}]`
  );
  console.log(
    `Item ${
      item.item_code || item.item_id
    }: Processed serial numbers: [${processedSerialNumbers.join(", ")}]`
  );

  // Calculate leftover serial numbers by removing processed ones
  const leftoverSerialNumbers = originalSerialNumbers.filter(
    (originalSN) => !processedSerialNumbers.includes(originalSN)
  );

  console.log(
    `Item ${
      item.item_code || item.item_id
    }: Leftover serial numbers: [${leftoverSerialNumbers.join(", ")}]`
  );

  // Return the leftover serial numbers as a comma-separated string
  return leftoverSerialNumbers.length > 0
    ? leftoverSerialNumbers.join(", ")
    : "";
};

// Enhanced quantity validation and line status determination
const validateAndUpdateTablePickingItems = (pickingItems) => {
  const errors = [];
  const updatedItems = pickingItems;

  console.log("before updated items:", updatedItems);
  for (const [index, item] of updatedItems.entries()) {
    // Safely parse quantities
    const qtyToPick = parseFloat(item.qty_to_pick) || 0;
    const pendingProcessQty = parseFloat(item.pending_process_qty) || 0;
    const pickedQty = parseFloat(item.picked_qty) || 0;

    console.log(
      `Item ${
        item.item_name || index
      }: qtyToPick=${qtyToPick}, pendingProcessQty=${pendingProcessQty}, pickedQty=${pickedQty}`
    );

    // Validation checks
    if (pickedQty < 0) {
      errors.push(
        `Picked quantity cannot be negative for item ${
          item.item_name || `#${index + 1}`
        }`
      );
      continue;
    }

    if (pickedQty > pendingProcessQty) {
      errors.push(
        `Picked quantity (${pickedQty}) cannot be greater than quantity to pick (${pendingProcessQty}) for item ${
          item.item_name || `#${index + 1}`
        }`
      );
      continue;
    }

    // Calculate pending process quantity
    const pending_process_qty = pendingProcessQty - pickedQty;

    updatedItems[index].line_status = "Completed";
    updatedItems[index].pending_process_qty = pending_process_qty;

    // Update serial numbers for serialized items - calculate leftover serial numbers
    if (item.is_serialized_item === 1 && pending_process_qty > 0) {
      const leftoverSerialNumbers = calculateLeftoverSerialNumbers(item);
      updatedItems[index].serial_numbers = leftoverSerialNumbers;
      console.log(
        `Updated serial_numbers for partially processed item ${item.item_name}: "${leftoverSerialNumbers}"`
      );
    } else if (item.is_serialized_item === 1 && pending_process_qty === 0) {
      // If fully processed, clear serial numbers
      updatedItems[index].serial_numbers = "";
      console.log(
        `Cleared serial_numbers for fully processed item ${item.item_name}`
      );
    }

    console.log(`Item ${item.item_name || index} line status: Completed`);
  }

  return { updatedItems, errors };
};

// For quantities - 3 decimal places
const roundQty = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(3));
};

// For prices - 4 decimal places
const roundPrice = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(4));
};

// Helper function to safely parse JSON
const parseJsonSafely = (jsonString, defaultValue = []) => {
  try {
    return jsonString ? JSON.parse(jsonString) : defaultValue;
  } catch (error) {
    console.error("JSON parse error:", error);
    return defaultValue;
  }
};

const updateEntry = async (toData, toId) => {
  try {
    for (const item of toData.table_picking_items) {
      if (item.select_serial_number) {
        item.select_serial_number = null;
      }
    }

    await db.collection("transfer_order").doc(toId).update(toData);

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

const updatePickingPlan = async (ppId, toData) => {
  try {
    // Update each line item's picking status based on its line_status
    await Promise.all(
      toData.table_picking_items.map(async (toItem) => {
        return await db
          .collection("picking_plan_fwii8mvb_sub")
          .doc(toItem.to_line_id)
          .update({ picking_status: "Completed" });
      })
    );

    const pp = await db.collection("picking_plan").doc(ppId).get();
    let ppData = pp.data[0];

    if (ppData.to_status === "Cancelled") {
      console.log("Picking Plan is already cancelled");
      return;
    }

    const pickingStatus = ppData.picking_status;

    if (pickingStatus === "Completed") {
      this.$message.error("Picking Plan is already completed");
      return;
    }

    await db.collection("picking_plan").doc(toId).update({
      picking_status: "Completed",
    });
  } catch (error) {
    this.$message.error("Error updating Picking Plan");
    console.error("Error updating Picking Plan:", error);
  }
};

const createPickingRecord = async (toData) => {
  const pickingRecords = [];
  for (const item of toData.table_picking_items) {
    if (item.picked_qty > 0 && item.line_status !== "Cancelled") {
      const pickingRecord = {
        item_code: item.item_code,
        item_name: item.item_name,
        item_desc: item.item_desc,
        batch_no: item.batch_no,
        target_batch: item.batch_no,
        so_no: item.so_no,
        gd_no: item.gd_no,
        so_id: item.so_id,
        gd_id: item.gd_id,
        so_line_id: item.so_line_id,
        gd_line_id: item.gd_line_id,
        store_out_qty: item.picked_qty,
        item_uom: item.item_uom,
        source_bin: item.source_bin,
        target_location: item.source_bin,
        remark: item.remark,
        confirmed_by: this.getVarGlobal("nickname"),
        confirmed_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      };

      // Add serial numbers for serialized items with line break formatting
      if (
        item.is_serialized_item === 1 &&
        item.select_serial_number &&
        Array.isArray(item.select_serial_number)
      ) {
        const trimmedSerialNumbers = item.select_serial_number
          .map((sn) => sn.trim())
          .filter((sn) => sn !== "");

        if (trimmedSerialNumbers.length > 0) {
          pickingRecord.serial_numbers = trimmedSerialNumbers.join("\n");

          console.log(
            `Added ${trimmedSerialNumbers.length} serial numbers to picking record for ${item.item_code}: ${pickingRecord.serial_numbers}`
          );
        }
      }

      pickingRecords.push(pickingRecord);
    }
  }

  toData.table_picking_records =
    toData.table_picking_records.concat(pickingRecords);
};

// Main execution wrapped in an async IIFE
(async () => {
  try {
    this.showLoading();
    const data = this.getValues();
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
      {
        name: "table_picking_items",
        label: "Picking Items",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    // Validate items
    for (const [index] of data.table_picking_items.entries()) {
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

    const tablePickingItems = this.getValue("table_picking_items");
    console.log("Table Picking Items:", tablePickingItems);
    // Validate quantities and update line statuses
    const { updatedItems, errors } =
      validateAndUpdateTablePickingItems(tablePickingItems);

    console.log("Updated items:", updatedItems);

    if (errors.length > 0) {
      this.hideLoading();
      this.$message.error(errors.join("; "));
      return;
    }

    // Prepare transfer order object
    const toData = {
      to_status: "Completed",
      plant_id: data.plant_id,
      to_id: data.to_id,
      movement_type: data.movement_type,
      customer_id: data.customer_id,
      ref_doc_type: data.ref_doc_type,
      pp_id: data.pp_id,
      so_no: data.so_no,
      assigned_to: data.assigned_to,
      created_by: data.created_by,
      created_at: data.created_at,
      organization_id: organizationId,
      ref_doc: data.ref_doc,
      table_picking_items: updatedItems,
      table_picking_records: data.table_picking_records,
      remarks: data.remarks,
    };

    await createPickingRecord(toData);

    // Clean up undefined/null values
    Object.keys(toData).forEach((key) => {
      if (toData[key] === undefined || toData[key] === null) {
        delete toData[key];
      }
    });

    const toId = data.id;
    const ppId = data.pp_id;
    await updateEntry(organizationId, toData, toId, originalToStatus);
    await updatePickingPlan(ppId, toData);

    // Success message with status information
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
