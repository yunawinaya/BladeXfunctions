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

const validateField = (value, field) => {
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
      document_types: "Items",
      is_deleted: 0,
      organization_id: organizationId,
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
        document_types: "Items",
        is_deleted: 0,
        organization_id: organizationId,
        is_active: 1,
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
    .collection("Item")
    .where({ material_code: generatedPrefix })
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
      "Could not generate a unique Item number after maximum attempts"
    );
  }

  return { prefixToShow, runningNumber };
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

(async () => {
  try {
    this.showLoading();

    const data = this.getValues();

    const page_status = data.page_status;
    const item_no = data.id;

    // Define required fields
    const requiredFields = [
      { name: "material_type", label: "Item Type" },
      { name: "material_name", label: "Item Name" },
      { name: "material_code", label: "Item Code" },
      { name: "item_category", label: "Item Category" },
      { name: "based_uom", label: "Based UOM" },
    ];

    const missingFields = await validateForm(data, requiredFields);

    await this.validate("material_code");

    if (missingFields.length === 0) {
      // Get organization ID
      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      // Prepare entry data
      const entry = {
        is_active: data.is_active,
        item_image: data.item_image,
        material_type: data.material_type,
        organization_id: organizationId,
        material_code: data.material_code,
        material_name: data.material_name,
        item_category: data.item_category,
        material_sub_category: data.material_sub_category,
        material_desc: data.material_desc,
        material_costing_method: data.material_costing_method,
        stock_control: data.stock_control,
        show_delivery: data.show_delivery,
        show_receiving: data.show_receiving,
        based_uom: data.based_uom,
        table_uom_conversion: data.table_uom_conversion,
        purchase_tariff_id: data.purchase_tariff_id,
        mat_purchase_currency_id: data.mat_purchase_currency_id,
        mat_purchase_tax_id: data.mat_purchase_tax_id,
        purchase_tax_percent: data.purchase_tax_percent,
        purchase_unit_price: data.purchase_unit_price,
        sales_tariff_id: data.sales_tariff_id,
        mat_sales_tax_id: data.mat_sales_tax_id,
        sales_tax_percent: data.sales_tax_percent,
        mat_sales_currency_id: data.mat_sales_currency_id,
        sales_unit_price: data.sales_unit_price,
        item_batch_management: data.item_batch_management,
        batch_number_genaration: data.batch_number_genaration,
        serial_number_management: data.serial_number_management,
        is_single_unit_serial: data.is_single_unit_serial,
        serial_no_generate_rule: data.serial_no_generate_rule,
        brand_id: data.brand_id,
        brand_artwork_id: data.brand_artwork_id,
        subform_packaging_remark: data.subform_packaging_remark,
        reorder_level: data.reorder_level,
        lead_time: data.lead_time,
        assembly_cost: data.assembly_cost,
        bom_related: data.bom_related,
        reorder_quantity: data.reorder_quantity,
        irbm_id: data.irbm_id,
        production_time: data.production_time,
        additional_remark: data.additional_remark,
        over_receive_tolerance: data.over_receive_tolerance,
        under_receive_tolerance: data.under_receive_tolerance,
        over_delivery_tolerance: data.over_delivery_tolerance,
        under_delivery_tolerance: data.under_delivery_tolerance,
        posted_status: "Pending Post",
        barcode_number: data.barcode_number,
        purchase_default_uom: data.purchase_default_uom,
        sales_default_uom: data.sales_default_uom,
        receiving_inspection: data.receiving_inspection,
        table_default_bin: data.table_default_bin,
        is_base: data.is_base,
        last_transaction_date: data.last_transaction_date,
      };

      // Add or update based on page status
      if (page_status === "Add" || page_status === "Clone") {
        try {
          if (entry.material_code === data.item_current_prefix) {
            const prefixData = await getPrefixData(organizationId);

            if (prefixData.length !== 0) {
              const { prefixToShow, runningNumber } = await findUniquePrefix(
                prefixData
              );

              await updatePrefix(organizationId, runningNumber);

              entry.material_code = prefixToShow;
            }
          }

          await db.collection("Item").add(entry);

          if (organizationId) {
            const resAI = await db
              .collection("accounting_integration")
              .where({ organization_id: organizationId })
              .get();

            if (resAI && resAI.data.length > 0) {
              const aiData = resAI.data[0];

              if (aiData.acc_integration_type === "SQL Accounting") {
                // Run SQL workflow
                console.log("Calling SQL Accounting workflow");
                await this.runWorkflow(
                  "1906666085143818241",
                  { key: "value" },
                  (res) => {
                    console.log("成功结果：", res);
                    this.$message.success("Save item successfully.");
                    closeDialog();
                  },
                  (err) => {
                    console.error("失败结果：", err);
                    this.$message.error(err);
                    this.hideLoading();
                  }
                );
              } else if (
                aiData.acc_integration_type === "AutoCount Accounting"
              ) {
                await closeDialog();
                console.log("Calling AutoCount workflow");
              } else if (
                aiData.acc_integration_type === "No Accounting Integration"
              ) {
                await closeDialog();
                console.log("Not calling workflow");
              } else {
                await closeDialog();
              }
            }
          }
        } catch (error) {
          console.error("Error adding item:", error);
          this.hideLoading();
          this.$message.error(
            error.message || "An error occurred while adding the item."
          );
        }
      } else if (page_status === "Edit") {
        try {
          // Update the existing item
          if (!item_no) {
            throw new Error("Item ID not found");
          }

          await db.collection("Item").doc(item_no).update(entry);

          if (organizationId) {
            const resAI = await db
              .collection("accounting_integration")
              .where({ organization_id: organizationId })
              .get();

            if (resAI && resAI.data.length > 0) {
              const aiData = resAI.data[0];

              if (aiData.acc_integration_type === "SQL Accounting") {
                // Run SQL workflow
                console.log("Calling SQL Accounting workflow");
                // Run workflow
                await this.runWorkflow(
                  "1906666085143818241",
                  { key: "value" },
                  (res) => {
                    console.log("成功结果：", res);
                    this.$message.success("Save item successfully.");
                    closeDialog();
                  },
                  (err) => {
                    console.error("失败结果：", err);
                    this.$message.error(err);
                    this.hideLoading();
                  }
                );
              } else if (
                aiData.acc_integration_type === "AutoCount Accounting"
              ) {
                await closeDialog();
                console.log("Calling AutoCount workflow");
              } else if (
                aiData.acc_integration_type === "No Accounting Integration"
              ) {
                await closeDialog();
                console.log("Not calling workflow");
              } else {
                await closeDialog();
              }
            }
          }

          // Close dialog after successful operation
          closeDialog();
        } catch (error) {
          console.error("Error updating item:", error);
          this.hideLoading();
          this.$message.error(
            error.message || "An error occurred while updating the item."
          );
        }
      } else {
        this.hideLoading();
        this.$message.error("Invalid page status");
      }
    } else {
      this.hideLoading();
      this.$message.error(`Validation errors: ${missingFields.join(", ")}`);
    }
  } catch (error) {
    this.hideLoading();

    // Try to get message from standard locations first
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
