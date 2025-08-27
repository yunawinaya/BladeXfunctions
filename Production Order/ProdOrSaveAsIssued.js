const createStockMovement = async (stockMovementData, organizationId, db) => {
  try {
    // Map table_bom to balance_index and stock_movement
    const tableBom = stockMovementData.table_bom || [];

    const stockMovementItems = tableBom.map((item, index) => ({
      item_selection: item.material_id,
      item_name: item.material_name,
      item_desc: item.material_desc,
      requested_qty: item.material_quantity,
      location_id: item.bin_location_id,
      quantity_uom: item.material_uom,
      organization_id: organizationId,
      issuing_plant: stockMovementData.plant_id || null,
      line_index: index + 1,
    }));

    const issued_by = await this.getVarGlobal("nickname");
    console.log("JN❤️", stockMovementData);

    // Initialize stock movement data
    const stockMovement = {
      movement_type: "Location Transfer",
      stock_movement_no: "",
      movement_reason: "Bin Location Transfer",
      stock_movement_status: "Created",
      issued_by: issued_by || "",
      issue_date: stockMovementData.created_at || new Date(),
      issuing_operation_faci: stockMovementData.plant_id,
      stock_movement: stockMovementItems,
      organization_id: organizationId,
      is_production_order: 1,
      production_order_id: stockMovementData.id,
      is_deleted: 0,
      create_time: new Date(),
      update_time: new Date(),
    };

    const prefixData = await getPrefixData(
      organizationId,
      "Stock Movement",
      "Location Transfer"
    );

    if (prefixData !== null) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId,
        "Stock Movement",
        "Location Transfer"
      );

      await updatePrefix(
        organizationId,
        runningNumber,
        "Stock Movement",
        "Location Transfer"
      );

      stockMovement.stock_movement_no = prefixToShow;
    }

    // Add stock movement to database
    await db.collection("stock_movement").add(stockMovement);

    return { success: true };
  } catch (error) {
    console.error("Error creating Stock Movement:", error);
    throw error;
  }
};

const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const createEntry = (data) => ({
  production_order_no: data.production_order_no,
  production_order_status: "Issued",
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
  organization_id: data.organization_id,
  process_source: data.process_source,
  process_route_no: data.process_route_no,
  process_route_name: data.process_route_name,
  table_process_route: data.table_process_route,
  tenant_id: data.tenant_id,
  table_bom: data.table_bom,
  bom_id: data.bom_id,
  actual_execute_date: data.actual_execute_date,
  execute_completion_date: data.execute_completion_date,
  completion_remarks: data.completion_remarks,
  yield_qty: data.yield_qty,
  target_bin_location: data.target_bin_location,
  table_mat_confirmation: data.table_bom
    ? data.table_bom.map((item) => ({
        material_id: item.material_id,
        material_name: item.material_name,
        material_desc: item.material_desc,
        material_category: item.material_category,
        material_uom: item.material_uom,
        item_process_id: item.item_process_id,
        bin_location_id: item.bin_location_id,
        material_required_qty: item.material_quantity,
        material_actual_qty: item.material_quantity,
        item_remarks: item.item_remarks,
      }))
    : [],
  batch_id: data.batch_id,
});

const validateForm = (data, requiredFields, planType) => {
  const missingFields = [];

  if (planType === "Make to Order") {
    requiredFields.push({
      name: "table_sales_order",
      label: "Sales Order",
      isArray: true,
      arrayType: "object",
      arrayFields: [{ name: "sales_order_id", label: "SO Number" }],
    });
  }

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

const getPrefixData = async (organizationId, documentTypes, movementTypes) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: documentTypes,
      ...(documentTypes === "Stock Movement"
        ? { movement_type: movementTypes || null }
        : {}),
      is_deleted: 0,
      organization_id: organizationId,
      is_active: 1,
    })
    .get();

  const prefixData = await prefixEntry.data[0];

  return prefixData;
};

const updatePrefix = async (
  organizationId,
  runningNumber,
  documentTypes,
  movementTypes
) => {
  try {
    await db
      .collection("prefix_configuration")
      .where({
        document_types: documentTypes,
        ...(documentTypes === "Stock Movement"
          ? { movement_type: movementTypes || null }
          : {}),
        is_deleted: 0,
        organization_id: organizationId,
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

const checkUniqueness = async (
  generatedPrefix,
  organizationId,
  documentTypes,
  movementTypes
) => {
  if (documentTypes === "Production Order") {
    const existingDoc = await db
      .collection("production_order")
      .where({
        production_order_no: generatedPrefix,
        organization_id: organizationId,
      })
      .get();

    return existingDoc.data[0] ? false : true;
  } else if (documentTypes === "Stock Movement") {
    const existingDoc = await db
      .collection("stock_movement")
      .where({
        stock_movement_no: generatedPrefix,
        organization_id: organizationId,
      })
      .get();

    return existingDoc.data[0] ? false : true;
  }
};

const findUniquePrefix = async (
  prefixData,
  organizationId,
  documentTypes,
  movementTypes
) => {
  const now = new Date();
  let prefixToShow;
  let runningNumber = prefixData.running_number;
  let isUnique = false;
  let maxAttempts = 10;
  let attempts = 0;

  while (!isUnique && attempts < maxAttempts) {
    attempts++;
    prefixToShow = await generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(
      prefixToShow,
      organizationId,
      documentTypes,
      movementTypes
    );
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    this.$message.error(
      `Could not generate a unique ${documentTypes} number after maximum attempts`
    );
  }

  return { prefixToShow, runningNumber };
};

(async () => {
  try {
    const self = this;
    const page_status = self.getValue("page_status");
    const productionOrderId = self.getValue("id");
    const allData = self.getValues();
    this.showLoading();

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    const requiredFields = [
      { name: "plant_id", label: "Plant" },
      { name: "plan_type", label: "Plan Type" },
      { name: "material_id", label: "Item Code" },
      {
        name: "table_bom",
        label: "Bill of Materials",
        isArray: true,
        arrayType: "object",
        arrayFields: [{ name: "bin_location_id", label: "Bin Location" }],
      },
    ];

    const missingFields = await validateForm(
      allData,
      requiredFields,
      allData.plan_type
    );

    if (missingFields.length === 0) {
      if (page_status === "Add" || page_status == undefined) {
        try {
          const prefixData = await getPrefixData(
            organizationId,
            "Production Order",
            ""
          );

          if (prefixData !== null) {
            const { prefixToShow, runningNumber } = await findUniquePrefix(
              prefixData,
              organizationId,
              "Production Order",
              ""
            );

            await updatePrefix(
              organizationId,
              runningNumber,
              "Production Order",
              ""
            );

            allData.production_order_no = prefixToShow;
          }

          const entry = createEntry(allData);

          const productionOrderResult = await db
            .collection("production_order")
            .add(entry);
          console.log("createStockMovement", productionOrderResult);

          await updateItemTransactionDate(entry);

          const stockMovementData = {
            id: productionOrderResult.data[0].id,
            created_at: new Date(),
            tenant_id: allData.tenant_id,
            plant_id: allData.plant_id,
            table_bom: allData.table_bom,
            organization_id: allData.organization_id,
          };

          await createStockMovement(
            stockMovementData,
            allData.organization_id,
            db,
            self
          );

          closeDialog();
        } catch (error) {
          this.hideLoading();
          console.error("Add operation failed:", error);
          this.$message.error(
            "Failed to create production order: " + error.message
          );
        }
      } else if (page_status === "Edit") {
        try {
          const entry = createEntry(allData);
          const prefixData = await getPrefixData(
            organizationId,
            "Production Order",
            ""
          );

          if (prefixData !== null) {
            const { prefixToShow, runningNumber } = await findUniquePrefix(
              prefixData,
              organizationId,
              "Production Order",
              ""
            );

            await updatePrefix(
              organizationId,
              runningNumber,
              "Production Order",
              ""
            );

            entry.production_order_no = prefixToShow;
          }

          console.log("Updating production order with ID:", productionOrderId);

          await db
            .collection("production_order")
            .doc(productionOrderId)
            .update(entry);

          await updateItemTransactionDate(entry);

          const stockMovementData = {
            id: productionOrderId,
            created_at: new Date(),
            tenant_id: allData.tenant_id,
            plant_id: allData.plant_id,
            table_bom: allData.table_bom,
            organization_id: organizationId,
          };

          await createStockMovement(
            stockMovementData,
            organizationId,
            db,
            self
          );

          closeDialog();
        } catch (error) {
          this.hideLoading();
          console.error("Edit operation failed:", error);
          this.$message.error(
            "Failed to update production order: " + error.message
          );
        }
      }
    } else {
      this.hideLoading();
      console.log(missingFields);
      this.$message.error(`Validation errors: ${missingFields.join(", ")}`);
    }
  } catch (error) {
    this.hideLoading();
    this.$message.error(error);
  }
})();
