const createStockMovement = async (
  stockMovementData,
  organizationId,
  db,
  self
) => {
  try {
    // Map table_bom to balance_index and stock_movement
    const tableBom = stockMovementData.table_bom || [];
    const balanceIndex = stockMovementData.balance_index || [];

    const stockMovementItems = tableBom.map((item) => ({
      item_selection: item.material_id,
      requested_qty: item.material_quantity,
      location_id: item.bin_location_id,
    }));

    // Initialize stock movement data
    const stockMovement = {
      movement_type: "Location Transfer",
      stock_movement_no: "",
      movement_reason: "Bin Location Transfer",
      stock_movement_status: "Draft",
      issued_by: stockMovementData.issued_by || "System",
      issue_date: stockMovementData.created_at || new Date(),
      tenant_id: stockMovementData.tenant_id || "000000",
      issuing_operation_faci: stockMovementData.plant_id || "000000",
      stock_movement: stockMovementItems,
      balance_index: balanceIndex,
      organization_id: organizationId,
      is_production_order: 1,
      production_order_id: stockMovementData.id,
      is_deleted: 0,
      create_time: new Date(),
      update_time: new Date(),
    };

    // Fetch movement type ID
    const movementTypeQuery = await db
      .collection("blade_dict")
      .where({ dict_key: "Location Transfer" })
      .get();
    if (!movementTypeQuery.data || movementTypeQuery.data.length === 0) {
      throw new Error("No stock movement type found for LOT");
    }
    // stockMovement.movement_type = movementTypeQuery.data[0].id;

    // Fetch movement reason ID
    const movementReasonQuery = await db
      .collection("stock_movement_reason")
      .where({ sm_reason_name: "Bin Location Transfer" })
      .get();
    if (!movementReasonQuery.data || movementReasonQuery.data.length === 0) {
      throw new Error(
        "No stock movement reason found for Bin Location Transfer"
      );
    }
    // stockMovement.movement_reason = movementReasonQuery.data[0].id;

    // Generate unique stock movement number
    const prefixEntryQuery = await db
      .collection("prefix_configuration")
      .where({
        document_types: "Stock Movement",
        movement_type: "Location Transfer",
        is_deleted: 0,
        organization_id: organizationId,
      })
      .get();
    if (!prefixEntryQuery.data || prefixEntryQuery.data.length === 0) {
      throw new Error("No prefix configuration found for Stock Movement");
    }

    const prefixData = prefixEntryQuery.data[0];
    const now = new Date();
    let runningNumber = parseInt(prefixData.running_number);
    let isUnique = false;
    let maxAttempts = 10;
    let attempts = 0;

    const generatePrefix = (runNumber) => {
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
      return generated;
    };

    const checkUniqueness = async (generatedPrefix) => {
      const existingDoc = await db
        .collection("stock_movement")
        .where({ stock_movement_no: generatedPrefix })
        .get();
      return !existingDoc.data || existingDoc.data.length === 0;
    };

    let prefixToShow;
    while (!isUnique && attempts < maxAttempts) {
      attempts++;
      prefixToShow = generatePrefix(runningNumber);
      isUnique = await checkUniqueness(prefixToShow);
      if (!isUnique) {
        runningNumber++;
      }
    }

    if (!isUnique) {
      throw new Error(
        "Could not generate a unique Stock Movement number after maximum attempts"
      );
    }

    stockMovement.stock_movement_no = prefixToShow;

    // Add stock movement to database
    await db.collection("stock_movement").add(stockMovement);

    // Update prefix configuration
    await db
      .collection("prefix_configuration")
      .doc(prefixData.id)
      .update({ running_number: runningNumber + 1 });

    // Update UI data
    self.setData({ stock_movement_no: prefixToShow });

    return { success: true, stock_movement_no: prefixToShow };
  } catch (error) {
    console.error("Error creating Stock Movement:", error);
    throw error;
  }
};

// Integration with existing production order code
const self = this;
const page_status = self.getValue("page_status");
const productionOrderId = self.getValue("id");
const allData = self.getValues();

const closeDialog = () => {
  try {
    if (self.parentGenerateForm) {
      self.parentGenerateForm.$refs.SuPageDialogRef.hide();
      self.parentGenerateForm.refresh();
    }
  } catch (error) {
    console.error("Error closing dialog:", error);
  }
};
let organizationId = this.getVarGlobal("deptParentId");
if (organizationId === "0") {
  organizationId = this.getVarSystem("deptIds").split(",")[0];
}
const createEntry = (data) => ({
  production_order_no: data.production_order_no,
  production_order_status: "Issued",
  production_order_name: data.production_order_name,
  plant_id: data.plant_id,
  plan_type: data.plan_type,
  material_id: data.material_id,
  priority: data.priority,
  planned_qty: data.planned_qty,
  planned_qty_uom: data.planned_qty_uom,
  lead_time: data.lead_time,
  table_sales_order: data.table_sales_order,
  organization_id: organizationId,
  process_source: data.process_source,
  process_route_no: data.process_route_no,
  process_route_name: data.process_route_name,
  table_process_route: data.table_process_route,
  create_user: data.create_user,
  create_dept: data.create_dept,
  create_time: data.create_time || new Date(),
  update_user: data.update_user,
  update_time: data.update_time || new Date(),
  is_deleted: data.is_deleted || 0,
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
        ...item,
        material_required_qty: item.material_quantity,
      }))
    : [],
  batch_id: data.batch_id,
});

const validateData = (data) => {
  const requiredFields = [
    { field: "production_order_name", label: "Production Order Name" },
    { field: "plant_id", label: "Plant" },
    { field: "plan_type", label: "Plan Type" },
    { field: "material_id", label: "Item Code" },
    { field: "table_bom", label: "Bill of Materials", isArray: true },
  ];

  for (const { field, label, isArray } of requiredFields) {
    if (isArray) {
      if (
        !data[field] ||
        !Array.isArray(data[field]) ||
        data[field].length === 0
      ) {
        showErrorPopup(`${label} cannot be empty`);
        return false;
      }
    } else {
      if (!data[field] || data[field].toString().trim() === "") {
        showErrorPopup(`${label} cannot be empty`);
        return false;
      }
    }
  }

  return true;
};

// Add a helper method to show error popup using $alert
const showErrorPopup = (message) => {
  try {
    // Using $alert (assumes Element UI or similar framework)
    this.$alert(message, "Error", {
      confirmButtonText: "OK",
      type: "error",
    });
  } catch (error) {
    console.error("Error showing alert:", error);
    // Fallback to native alert if $alert fails
    alert(message);
  }
};

if (page_status === "Add" || page_status == undefined) {
  try {
    if (!validateData(allData)) {
      return; // Stop execution if validation fails
    }

    const prefixEntry = await db
      .collection("prefix_configuration")
      .where({ document_types: "Production Order", is_deleted: 0 })
      .get();
    if (!prefixEntry.data || prefixEntry.data.length === 0) {
      throw new Error("No prefix configuration found");
    }

    const currDraftNum = parseInt(prefixEntry.data[0].draft_number) + 1;
    const newPrefix = `${allData.production_order_no || currDraftNum}`;

    const entry = createEntry(allData);
    entry.production_order_no = newPrefix;

    const productionOrderResult = await db
      .collection("production_order")
      .add(entry);
    console.log("createStockMovement", productionOrderResult);

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

    await db
      .collection("prefix_configuration")
      .doc(prefixEntry.data[0].id)
      .update({ draft_number: currDraftNum });

    closeDialog();
  } catch (error) {
    console.error("Add operation failed:", error);
    showErrorPopup("Failed to create production order: " + error.message);
  }
} else if (page_status === "Edit") {
  try {
    if (!validateData(allData)) {
      return; // Stop execution if validation fails
    }
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }
    const entry = createEntry(allData);
    const prefixQuery = await db
      .collection("prefix_configuration")
      .where({
        document_types: "Production Order",
        is_deleted: 0,
        organization_id: organizationId,
        is_active: 1,
      })
      .get();

    let newPrefix = entry.production_order_no;
    if (prefixQuery.data && prefixQuery.data.length > 0) {
      const prefixData = prefixQuery.data[0];
      const now = new Date();
      let runningNumber = parseInt(prefixData.running_number || 0);
      let isUnique = false;
      let maxAttempts = 10;
      let attempts = 0;

      const generatePrefix = (runNumber) => {
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
        return generated;
      };

      const checkUniqueness = async (generatedPrefix) => {
        const existingDoc = await db
          .collection("production_order")
          .where({ production_order_no: generatedPrefix })
          .get();
        return !existingDoc.data || existingDoc.data.length === 0;
      };

      while (!isUnique && attempts < maxAttempts) {
        attempts++;
        newPrefix = generatePrefix(runningNumber);
        isUnique = await checkUniqueness(newPrefix);
        if (!isUnique) {
          runningNumber++;
        }
      }

      if (!isUnique) {
        throw new Error(
          "Could not generate a unique Production Order number after maximum attempts"
        );
      }

      await db
        .collection("prefix_configuration")
        .doc(prefixData.id)
        .update({
          running_number: runningNumber + 1,
          has_record: 1,
        });
    }

    entry.production_order_no = newPrefix;
    console.log("Updating production order with ID:", productionOrderId);

    await db
      .collection("production_order")
      .doc(productionOrderId)
      .update(entry);

    const stockMovementData = {
      id: productionOrderId,
      created_at: new Date(),
      tenant_id: allData.tenant_id,
      plant_id: allData.plant_id,
      table_bom: allData.table_bom,
      organization_id: organizationId,
    };

    await createStockMovement(stockMovementData, organizationId, db, self);

    closeDialog();
  } catch (error) {
    console.error("Edit operation failed:", error);
    showErrorPopup("Failed to update production order: " + error.message);
  }
}
