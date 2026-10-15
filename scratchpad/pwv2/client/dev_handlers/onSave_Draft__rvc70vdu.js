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

const validateField = (value, field) => {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return value <= 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return !value;
};

// Main execution wrapped in an async IIFE
(async () => {
  try {
    this.showLoading();
    const data = await this.getValues();

    // Get page status and goods delivery ID
    const page_status = data.page_status;
    const transferOrderId = data.id;

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

    // Prepare transfer order object
    let to = data;
    to.to_status = "Draft";
    to.organization_id = organizationId;

    if (page_status === "Add") {
      if (
        to.to_id_type !== -9999 &&
        (!to.to_id || to.to_id === null || to.to_id === "")
      ) {
        to.to_id = "draft";
      }
    }

    // Validate form
    const missingFields = validateForm(to, requiredFields);

    if (missingFields.length === 0) {
      // Get organization ID
      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      // Clean up undefined/null values
      Object.keys(to).forEach((key) => {
        if (to[key] === undefined || to[key] === null) {
          delete to[key];
        }
      });

      // Add or update based on page status
      if (page_status === "Add") {
        await db.collection("transfer_order_putaway").add(to);
        this.$message.success("Add successfully");
        closeDialog();
      } else if (page_status === "Edit") {
        await db
          .collection("transfer_order_putaway")
          .doc(transferOrderId)
          .update(to);
        this.$message.success("Update successfully");
        closeDialog();
      } else {
        console.log("Unknown page status:", page_status);
        this.hideLoading();
        this.$message.error("Invalid page status");
        return;
      }
    } else {
      this.hideLoading();
      this.$message.error(`Validation errors: ${missingFields.join(", ")}`);
    }
  } catch (error) {
    console.error("Error in main function:", error);
    this.hideLoading();
    this.$message.error(
      error.message ||
        "An error occurred while processing the transfer order draft",
    );
  } finally {
    console.log("Draft function execution completed");
  }
})();
