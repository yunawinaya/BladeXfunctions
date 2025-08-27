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

const closeDialog = () => {
  try {
    if (this.parentGenerateForm) {
      this.parentGenerateForm.$refs.SuPageDialogRef.hide();
      this.parentGenerateForm.refresh();
      this.hideLoading();
    }
  } catch (error) {
    console.error("Error closing dialog:", error);
  }
};

// Define common entry structure
const createEntry = (data, organizationId) => ({
  production_order_no: data.production_order_no || "Draft",
  production_order_status: data.production_order_status || "Draft",
  production_order_name: data.production_order_name,
  plant_id: data.plant_id,
  plan_type: data.plan_type,
  material_id: data.material_id,
  material_name: data.material_name,
  material_desc: data.material_desc,
  priority: data.priority,
  planned_qty: data.planned_qty,
  planned_qty_uom: data.planned_qty_uom,
  lead_time: data.lead_time,
  table_sales_order: data.table_sales_order,
  process_source: data.process_source,
  process_route_no: data.process_route_no,
  process_route_name: data.process_route_name,
  table_process_route: data.table_process_route,
  create_user: data.create_user,
  organization_id: organizationId,
  create_dept: data.create_dept,
  create_time: data.create_time || new Date(),
  update_user: data.update_user,
  update_time: data.update_time || new Date(),
  is_deleted: data.is_deleted || 0,
  tenant_id: data.tenant_id,
  bom_id: data.bom_id,
  table_bom: data.table_bom,
  actual_execute_date: data.actual_execute_date,
  execute_completion_date: data.execute_completion_date,
  completion_remarks: data.completion_remarks,
  yield_qty: data.yield_qty,
  serial_number_data: data.serial_number_data,
  is_serialized_item: data.is_serialized_item,
  is_single: data.is_single,
  is_auto: data.is_auto,
  target_bin_location: data.target_bin_location,
  table_mat_confirmation: data.table_mat_confirmation,
  batch_id: data.batch_id,
});

const updateItemTransactionDate = async (entry) => {
  try {
    const tableBOM = entry.table_bom;

    const uniqueItemIds = [
      ...new Set(
        tableBOM
          .filter((item) => item.material_id)
          .map((item) => item.material_id)
      ),
    ];

    const date = new Date().toISOString();
    for (const [index, item] of uniqueItemIds.entries()) {
      try {
        await db
          .collection("Item")
          .doc(item)
          .update({ last_transaction_date: date });
      } catch (error) {
        throw new Error(
          `Cannot update last transaction date for item #${index + 1}.`,
          error
        );
      }
    }
  } catch (error) {
    throw new Error(error);
  }
};

(async () => {
  const page_status = this.getValue("page_status");
  const productionOrderId = this.getValue("id");
  const allData = this.getValues();
  this.showLoading();

  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }

  const requiredFields = [
    { name: "plant_id", label: "Plant" },
    {
      name: "table_bom",
      label: "Bill of Materials",
      isArray: true,
      arrayType: "object",
      arrayFields: [],
    },
  ];

  const missingFields = await validateForm(allData, requiredFields);

  if (missingFields.length > 0) {
    this.hideLoading();
    this.$message.error(`Validation errors: ${missingFields.join(", ")}`);
    return;
  }

  if (page_status === "Add" || page_status === undefined) {
    try {
      const entry = createEntry(allData, organizationId);

      db.collection("prefix_configuration")
        .where({
          document_types: "Production Order",
          is_deleted: 0,
          organization_id: organizationId,
          is_active: 1,
        })
        .get()
        .then((prefixResponse) => {
          if (prefixResponse.data || prefixResponse.data.length >= 0) {
            console.log("prefixResponse", prefixResponse);

            const prefixEntry = prefixResponse.data[0];
            const currDraftNum =
              prefixEntry.draft_number != null &&
              prefixEntry.draft_number !== undefined
                ? parseInt(prefixEntry.draft_number) + 1
                : 1; // or some default value like 0
            const newPrefix = `DRAFT-${prefixEntry?.prefix_value}-${currDraftNum}`;
            entry.production_order_no = newPrefix;

            db.collection("prefix_configuration")
              .doc(prefixEntry.id)
              .update({ draft_number: currDraftNum });
          }

          // Add the production order
          return db.collection("production_order").add(entry);
        })
        .then(async () => {
          await updateItemTransactionDate(entry);
          closeDialog();
        })
        .catch((error) => {
          console.error("Error adding Production Order:", error);
          throw error;
        });
    } catch (error) {
      this.hideLoading();
      console.error("Add operation failed:", error);
      throw error;
    }
  } else if (page_status === "Edit") {
    try {
      const entry = createEntry(allData);

      db.collection("production_order")
        .doc(productionOrderId)
        .update(entry)
        .then(async () => {
          await updateItemTransactionDate(entry);
          closeDialog();
        })
        .catch((error) => {
          console.error("Error updating Production Order:", error);
          throw error;
        });
    } catch (error) {
      this.hideLoading();
      this.$message.error(error.message || String(error));
      console.error("Edit operation failed:", error);
      throw error;
    }
  }
})();
