const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.parentGenerateForm.hide("tabs_picking");
    this.hideLoading();
  }
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

const addEntry = async (toData) => {
  try {
    await db.collection("transfer_order").add(toData);
  } catch (error) {
    console.error("Error in addEntry:", error);
    throw error;
  }
};

const updateEntry = async (toData, toId) => {
  try {
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

    return obj.toString();
  }
  return null;
};

const updateGoodsDeliveryPickingStatus = async (toData) => {
  try {
    const gdIDs = toData.table_picking_items
      .filter((item) => item.line_status !== "Cancelled")
      .map((item) => item.gd_id);

    await Promise.all(
      gdIDs.map((gdId) =>
        db.collection("goods_delivery").doc(gdId).update({
          picking_status: "Created",
        }),
      ),
    );

    const filterPickingItems = toData.table_picking_items.filter(
      (item) => item.line_status !== "Cancelled",
    );

    await Promise.all(
      filterPickingItems.map((toItem) =>
        db
          .collection("goods_delivery_fwii8mvb_sub")
          .where({ id: toItem.gd_line_id })
          .update({ picking_status: "Created" }),
      ),
    );
    this.$message.success("Goods Delivery picking status updated successfully");
  } catch (error) {
    this.$message.error("Error updating Goods Delivery picking status");
    console.error("Error flipping Goods Delivery picking status:", error);
  }
};

// Main execution wrapped in an async IIFE
(async () => {
  try {
    this.showLoading();
    const data = await this.getValues();
    const page_status = data.page_status;

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

    const newTransferOrderStatus = "Created";

    if (
      data.to_id_type !== -9999 &&
      (!data.to_id ||
        data.to_id === null ||
        data.to_id === "" ||
        data.to_status === "Draft")
    ) {
      data.to_id = "issued";
    }

    // Prepare transfer order object
    const toData = {
      to_status: newTransferOrderStatus,
      plant_id: data.plant_id,
      to_id: data.to_id,
      to_id_type: data.to_id_type,
      movement_type: data.movement_type,
      ref_doc_type: data.ref_doc_type,
      gd_no: data.gd_no,
      delivery_no: data.delivery_no,
      so_no: data.so_no,
      customer_id: data.customer_id,
      assigned_to: data.assigned_to,
      created_by: data.created_by,
      created_at: data.created_at,
      organization_id: organizationId,
      ref_doc: data.ref_doc,
      table_picking_items: data.table_picking_items,
      table_picking_records: data.table_picking_records,
      remarks: data.remarks,
    };

    // Clean up undefined/null values
    Object.keys(toData).forEach((key) => {
      if (toData[key] === undefined || toData[key] === null) {
        delete toData[key];
      }
    });

    let toId;

    // Perform action based on page status
    if (page_status === "Add") {
      await addEntry(toData);
      await updateGoodsDeliveryPickingStatus(toData);
    } else if (page_status === "Edit") {
      toId = data.id;
      await updateEntry(toData, toId);
      await updateGoodsDeliveryPickingStatus(toData);
    }

    const statusMessage = ` (Status updated to: ${newTransferOrderStatus})`;

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
