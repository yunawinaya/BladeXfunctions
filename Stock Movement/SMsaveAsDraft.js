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

const fillbackHeaderFields = async (entry) => {
  try {
    for (const [index, smLineItem] of entry.stock_movement.entries()) {
      smLineItem.organization_id = entry.organization_id;
      smLineItem.issuing_plant = entry.issuing_operation_faci || null;
      smLineItem.receiving_plant = entry.receiving_operation_faci || null;
      smLineItem.line_index = index + 1;
    }
    return entry.stock_movement;
  } catch (error) {
    throw new Error("Error processing Stock Movement.");
  }
};

const getPrefixData = async (organizationId, movementType) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Stock Movement",
      movement_type: movementType,
      is_deleted: 0,
      organization_id: organizationId,
      is_active: 1,
    })
    .get();

  const prefixData = await prefixEntry.data[0];

  return prefixData;
};

const generateDraftPrefix = async (organizationId, movementType) => {
  try {
    const prefixData = await getPrefixData(organizationId, movementType);
    if (prefixData !== null) {
      const currDraftNum = parseInt(prefixData.draft_number) + 1;
      const newPrefix = "DRAFT-" + prefixData.prefix_value + "-" + currDraftNum;

      db.collection("prefix_configuration")
        .where({
          document_types: "Stock Movement",
          movement_type: movementType,
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

const updateItemTransactionDate = async (entry) => {
  try {
    const tableSM = entry.stock_movement;

    const uniqueItemIds = [
      ...new Set(
        tableSM
          .filter((item) => item.item_selection)
          .map((item) => item.item_selection),
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
        );
      }
    }
  } catch (error) {
    throw new Error(error);
  }
};

(async () => {
  try {
    this.showLoading();
    let movementType = this.getValue("movement_type") || "";
    const data = this.getValues();
    const page_status = data.page_status;
    const stockMovementId = data.id;
    const requiredFields = [
      { name: "issuing_operation_faci", label: "Plant" },
      {
        name: "stock_movement",
        label: "Stock Movement Information",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    const missingFields = await validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      const {
        issue_date,
        stock_movement_no,
        movement_type,
        movement_type_id,
        movement_reason,
        issued_by,
        issuing_operation_faci,
        remarks,
        delivery_method,
        reference_documents,
        receiving_operation_faci,
        movement_id,
        is_production_order,
        production_order_id,
        driver_name,
        driver_contact_no,
        vehicle_no,
        pickup_date,
        courier_company,
        shipping_date,
        freight_charges,
        tracking_number,
        est_arrival_date,
        delivery_cost,
        est_delivery_date,
        shipping_company,
        date_qn0dl3t6,
        input_77h4nsq8,
        shipping_method,
        tracking_no,
        stock_movement,
        balance_index,
        sm_item_balance,
        table_item_balance,
        material_id,
        material_name,
        row_index,
        remark2,
        remark3,
      } = data;

      const entry = {
        stock_movement_status: "Draft",
        organization_id: organizationId,
        posted_status: "",
        issue_date,
        stock_movement_no,
        movement_type,
        movement_type_id,
        movement_reason,
        issued_by,
        issuing_operation_faci,
        remarks,
        delivery_method,
        reference_documents,
        receiving_operation_faci,
        movement_id,
        is_production_order,
        production_order_id,
        driver_name,
        driver_contact_no,
        vehicle_no,
        pickup_date,
        courier_company,
        shipping_date,
        freight_charges,
        tracking_number,
        est_arrival_date,
        delivery_cost,
        est_delivery_date,
        shipping_company,
        date_qn0dl3t6,
        input_77h4nsq8,
        shipping_method,
        tracking_no,
        stock_movement,
        balance_index,
        sm_item_balance,
        table_item_balance,
        material_id,
        material_name,
        row_index,
        remark2,
        remark3,
      };

      entry.stock_movement = await fillbackHeaderFields(entry);

      if (page_status === "Add" || page_status === "Clone") {
        const newPrefix = await generateDraftPrefix(
          organizationId,
          movementType,
        );
        entry.stock_movement_no = newPrefix;
        await db.collection("stock_movement").add(entry);
        this.$message.success("Add successfully");
      } else if (page_status === "Edit") {
        await db
          .collection("stock_movement")
          .doc(stockMovementId)
          .update(entry);
        this.$message.success("Update successfully");
      }

      await updateItemTransactionDate(entry);
      await closeDialog();
    } else {
      this.hideLoading();
      this.$message.error(`Validation errors: ${missingFields.join(", ")}`);
    }
  } catch (error) {
    this.$message.error(error);
  }
})();
