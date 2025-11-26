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
      document_types: "Packing",
      is_deleted: 0,
      organization_id: organizationId,
      is_active: 1,
    })
    .get();

  const prefixData = prefixEntry.data[0];

  return prefixData;
};

const generateDraftPrefix = async (organizationId) => {
  try {
    const prefixData = await getPrefixData(organizationId);
    if (prefixData && Object.keys(prefixData).length > 0) {
      const currDraftNum = parseInt(prefixData.draft_number) + 1;
      const newPrefix = "DRAFT-PKG-" + currDraftNum;

      await db
        .collection("prefix_configuration")
        .where({
          document_types: "Packing",
          organization_id: organizationId,
          is_deleted: 0,
        })
        .update({ draft_number: currDraftNum });

      return newPrefix;
    }
  } catch (error) {
    this.$message.error(error);
  }
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

// Main execution wrapped in an async IIFE
(async () => {
  try {
    this.showLoading();
    const data = await this.getValues();

    // Get page status and goods delivery ID
    const page_status = data.page_status;
    const packingId = data.id;

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

    if (missingFields.length === 0) {
      // Get organization ID
      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      // Prepare packing object
      let packing = {
        packing_status: "Draft",
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
        packing.created_at =
          data.created_at || new Date().toISOString().split("T")[0];
      }

      // Clean up undefined/null values
      Object.keys(packing).forEach((key) => {
        if (packing[key] === undefined || packing[key] === null) {
          delete packing[key];
        }
      });

      // Calculate header totals after cleanup
      packing = headerCalculation(packing);

      // Add or update based on page status
      if (page_status === "Add") {
        const newPrefix = await generateDraftPrefix(organizationId);
        packing.packing_no = newPrefix;
        await db.collection("packing").add(packing);
        this.$message.success("Add successfully");
        closeDialog();
      } else if (page_status === "Edit") {
        await db.collection("packing").doc(packingId).update(packing);
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
      error.message || "An error occurred while processing the packing draft"
    );
  } finally {
    console.log("Draft function execution completed");
  }
})();
