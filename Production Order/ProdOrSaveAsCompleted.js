// Centralized organization ID handling
const getOrganizationId = () => {
  const orgId = this.getVarGlobal("deptParentId");
  return orgId === "0" ? this.getVarSystem("deptIds").split(",")[0] : orgId;
};

// Movement type constants
const MOVEMENT_TYPES = {
  PRODUCTION_RECEIPT: "Production Receipt",
  GOODS_ISSUE: "Good Issue",
};

const createStockMovement = async (
  stockMovementData,
  organizationId,
  db,
  self,
  items,
  movementTypeCode,
  movementReasonName
) => {
  try {
    const itemsArray = Array.isArray(items) ? items : [items];
    if (itemsArray.length === 0) {
      throw new Error(
        `No items provided for stock movement (${movementTypeCode})`
      );
    }
    console.log(`Creating stock movement for ${movementTypeCode} items`);

    // Validate movement type exists
    const movementTypeQuery = await db
      .collection("blade_dict")
      .where({ dict_key: movementTypeCode })
      .get();
    if (!movementTypeQuery.data || movementTypeQuery.data.length === 0) {
      throw new Error(`No stock movement type found for ${movementTypeCode}`);
    }

    const balanceIndexData = await Promise.all(
      stockMovementData.balance_index.map(async (item) => {
        if (!item.material_id) {
          throw new Error(
            `Material ID is missing in balance index item for stock movement (${movementTypeCode})`
          );
        }

        const matItemQuery = await db
          .collection("Item")
          .where({ id: item.material_id, is_deleted: 0 })
          .get();
        if (!matItemQuery.data || matItemQuery.data.length === 0) {
          throw new Error(
            `Item not found for material_id: ${item.material_id}`
          );
        }
        const matItem = matItemQuery.data[0];
        const matBatchManagement = matItem.item_batch_management;
        const matCollectionName =
          matBatchManagement === 1 ? "item_batch_balance" : "item_balance";

        const matBalanceQuery = await db
          .collection(matCollectionName)
          .where({
            material_id: item.material_id,
            plant_id: stockMovementData.plant_id,
            location_id: item.bin_location_id,
            ...(matBatchManagement === 1
              ? { batch_id: item.batch_id || null }
              : {}),
          })
          .get();
        const existingMatBalance =
          matBalanceQuery.data && matBalanceQuery.data.length > 0
            ? matBalanceQuery.data[0]
            : null;

        return existingMatBalance
          ? {
              material_id: existingMatBalance.material_id,
              balance_id: existingMatBalance.id,
              sm_quantity: item.material_actual_qty || 0,
              batch_id:
                matBatchManagement === 1
                  ? existingMatBalance.batch_id || null
                  : null,
              unrestricted_qty: existingMatBalance.unrestricted_qty || 0,
              reserved_qty: existingMatBalance.reserved_qty || 0,
              qualityinsp_qty: existingMatBalance.qualityinsp_qty || 0,
              block_qty: existingMatBalance.block_qty || 0,
              intransit_qty: existingMatBalance.intransit_qty || 0,
              balance_quantity: existingMatBalance.balance_quantity || 0,
              location_id: existingMatBalance.location_id,
            }
          : {
              material_id: item.material_id,
              sm_quantity: item.material_actual_qty || 0,
              batch_id: matBatchManagement === 1 ? item.batch_id || null : null,
              location_id: item.bin_location_id,
            };
      })
    );

    const stockMovementItems = itemsArray.map(async (item, index) => {
      if (!item.material_id) {
        throw new Error(
          `Material ID is missing in item for stock movement (${movementTypeCode})`
        );
      }

      const itemQuery = await db
        .collection("Item")
        .where({ id: item.material_id, is_deleted: 0 })
        .get();
      if (!itemQuery.data || itemQuery.data.length === 0) {
        throw new Error(`Item not found for material_id: ${item.material_id}`);
      }

      const itemData = itemQuery.data[0];
      let stockSummary = "";

      if (movementTypeCode === "Good Issue") {
        const resUOM = await db
          .collection("unit_of_measurement")
          .where({ id: itemData.based_uom })
          .get();
        const uomName = resUOM?.data[0] ? resUOM.data[0].uom_name : "";

        const resBinLocation = await db
          .collection("bin_location")
          .where({ id: item.bin_location_id })
          .get();
        const binLocationName = resBinLocation?.data[0]
          ? resBinLocation.data[0].bin_location_combine
          : "";

        const batchId = item.batch_id;

        let batchNumber = "";
        if (batchId) {
          const resBatch = await db
            .collection("batch")
            .where({ id: batchId })
            .get();
          batchNumber = resBatch?.data[0]
            ? `\n[${resBatch.data[0].batch_number}]`
            : "";
        }

        stockSummary = `Total: ${item.material_actual_qty} ${uomName}\n\nDETAILS:\n1. ${binLocationName}: ${item.material_actual_qty} ${uomName}${batchNumber}`;
      }

      return {
        item_selection: item.material_id,
        item_name: item.material_name,
        item_desc: item.material_desc,
        requested_qty:
          item.yield_qty || item.quantity || item.material_actual_qty,
        received_quantity: item.yield_qty || 0,
        received_quantity_uom: allData.planned_qty_uom || "",
        quantity_uom: itemData.based_uom || "",
        total_quantity:
          item.yield_qty || item.quantity || item.material_actual_qty,
        location_id: item.target_bin_location || item.bin_location_id,
        category: item.category || null,
        unit_price: itemData.purchase_unit_price || 0,
        amount: itemData.purchase_unit_price * allData.planned_qty,
        batch_id:
          movementTypeCode === MOVEMENT_TYPES.PRODUCTION_RECEIPT &&
          itemData.item_batch_management === 1
            ? item.batch_id || null
            : null,
        stock_summary: stockSummary || "",
        organization_id: organizationId,
        issuing_plant: stockMovementData.plant_id || null,
        line_index: index + 1,
      };
    });

    const resolvedStockMovementItems = await Promise.all(stockMovementItems);

    const stockMovement = {
      movement_type: movementTypeCode,
      stock_movement_no: "",
      posted_status: "Unposted",
      movement_reason: movementReasonName,
      stock_movement_status: "Completed",
      issued_by: stockMovementData.issued_by || currentUser,
      issue_date: stockMovementData.created_at || new Date(),
      issuing_operation_faci: stockMovementData.plant_id || "000000",
      stock_movement: resolvedStockMovementItems,
      balance_index: balanceIndexData || [],
      is_production_order: 1,
      production_order_id: stockMovementData.id,
      organization_id: organizationId,
      is_deleted: 0,
      create_time: new Date(),
      update_time: new Date(),
    };

    const prefixEntryQuery = await db
      .collection("prefix_configuration")
      .where({
        document_types: "Stock Movement",
        movement_type: movementTypeCode,
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

    const checkUniqueness = async (generatedPrefix, organizationId) => {
      const existingDoc = await db
        .collection("stock_movement")
        .where({
          stock_movement_no: generatedPrefix,
          organization_id: organizationId,
        })
        .get();
      return !existingDoc.data || existingDoc.data.length === 0;
    };

    let prefixToShow;
    while (!isUnique && attempts < maxAttempts) {
      attempts++;
      prefixToShow = generatePrefix(runningNumber);
      isUnique = await checkUniqueness(prefixToShow, organizationId);
      if (!isUnique) runningNumber++;
    }

    if (!isUnique) {
      throw new Error(
        "Could not generate a unique Stock Movement number after maximum attempts"
      );
    }

    stockMovement.stock_movement_no = prefixToShow;

    await db.collection("stock_movement").add(stockMovement);

    await db
      .collection("prefix_configuration")
      .doc(prefixData.id)
      .update({ running_number: runningNumber + 1, has_record: 1 });

    return { success: true, stock_movement_no: prefixToShow };
  } catch (error) {
    console.error(
      `Error creating Stock Movement (${movementTypeCode}):`,
      error
    );
    throw error;
  }
};

const page_status = this.getValue("page_status");
const self = this;
const productionOrderId = this.getValue("id");
const allData = self.getValues();
const organizationId = getOrganizationId();
const currentUser = self.getVarGlobal("nickname") || "";

const closeDialog = () => {
  try {
    if (self.parentGenerateForm) {
      self.parentGenerateForm.$refs.SuPageDialogRef.hide();
      self.parentGenerateForm.refresh();
      this.hideLoading();
      console.log("Dialog closed and parent form refreshed");
    }
  } catch (error) {
    console.error("Error closing dialog:", error);
  }
};

const createEntry = (data) => ({
  production_order_no: data.production_order_no,
  production_order_status: "Completed",
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
  create_user: data.create_user || currentUser,
  organization_id: organizationId,
  category: data.category,
  create_dept: data.create_dept,
  create_time: data.create_time || new Date(),
  update_user: data.update_user || currentUser,
  update_time: data.update_time || new Date(),
  is_deleted: data.is_deleted || 0,
  tenant_id: data.tenant_id,
  table_bom: data.table_bom,
  actual_execute_date: data.actual_execute_date,
  execute_completion_date: data.execute_completion_date,
  completion_remarks: data.completion_remarks,
  yield_qty: data.yield_qty,
  target_bin_location: data.target_bin_location,
  table_mat_confirmation: data.table_mat_confirmation,
  batch_id: data.batch_id,
});

const validateData = (data) => {
  const errors = [];

  // Required field validation
  const requiredFields = {
    plant_id: "Plant",
    material_id: "Material",
    target_bin_location: "Target bin location",
    category: "Category",
    yield_qty: "Yield quantity",
    planned_qty_uom: "Planned quantity UOM",
  };

  for (const [field, label] of Object.entries(requiredFields)) {
    if (!data[field]) {
      errors.push(`${label} is required`);
    }
  }

  // Validate quantities are not negative
  if (data.yield_qty !== undefined && data.yield_qty < 0) {
    errors.push("Yield quantity cannot be negative");
  }

  if (data.yield_qty !== undefined && data.yield_qty === 0) {
    errors.push("Yield quantity must be greater than zero");
  }

  // Validate table_mat_confirmation
  if (
    !Array.isArray(data.table_mat_confirmation) ||
    data.table_mat_confirmation.length === 0
  ) {
    errors.push("At least one material confirmation entry is required");
  } else {
    data.table_mat_confirmation.forEach((mat, index) => {
      if (!mat.material_id) {
        errors.push(
          `Material ID is missing in confirmation entry ${index + 1}`
        );
      }
      if (mat.material_actual_qty < 0) {
        errors.push(
          `Material quantity cannot be negative in confirmation entry ${
            index + 1
          }`
        );
      }
    });
  }

  if (errors.length > 0) {
    this.$message.error(errors.join(", "));
    this.hideLoading();
    throw new Error("Validation failed: " + errors.join(", "));
  }

  console.log("Data validation passed for:", data.production_order_name);
  return true;
};

const preCheckMaterialQuantities = async (data) => {
  try {
    console.log(
      "Starting pre-check for material quantities in table_mat_confirmation, count:",
      data.table_mat_confirmation.length
    );

    const insufficientMaterials = [];

    for (const mat of data.table_mat_confirmation) {
      console.log(
        "Checking material_id:",
        mat.material_id,
        "Required quantity:",
        mat.material_actual_qty
      );

      const matItemQuery = await db
        .collection("Item")
        .where({ id: mat.material_id, is_deleted: 0 })
        .get();
      if (!matItemQuery.data || matItemQuery.data.length === 0) {
        throw new Error("Item not found for material_id: " + mat.material_id);
      }

      const matItem = matItemQuery.data[0];
      const matBatchManagement = matItem.item_batch_management;
      const matCollectionName =
        matBatchManagement === 1 ? "item_batch_balance" : "item_balance";

      // Check total available quantity
      const balanceQuery = await db
        .collection(matCollectionName)
        .where({
          material_id: mat.material_id,
          plant_id: data.plant_id,
          location_id: mat.bin_location_id,
        })
        .get();

      let totalAvailable = 0;
      if (balanceQuery.data && balanceQuery.data.length > 0) {
        balanceQuery.data.forEach((balance) => {
          totalAvailable += balance.reserved_qty || 0;
        });
      }

      if (totalAvailable < mat.material_actual_qty) {
        insufficientMaterials.push({
          material_id: mat.material_id,
          required: mat.material_actual_qty,
          available: totalAvailable,
        });
      }
    }

    if (insufficientMaterials.length > 0) {
      const errorMessages = insufficientMaterials.map(
        (m) =>
          `Material ${m.material_id}: required ${m.required}, available ${m.available}`
      );
      throw new Error("Insufficient stock: " + errorMessages.join("; "));
    }

    console.log("Pre-check for material quantities passed");
  } catch (error) {
    console.error("Pre-check for material quantities failed:", error);
    throw error;
  }
};

const categoryMap = {
  Unrestricted: "unrestricted_qty",
  "Quality Inspection": "qualityinsp_qty",
  Blocked: "block_qty",
  Reserved: "reserved_qty",
  "In Transit": "intransit_qty",
};

const calculateCostingAndUpdateTables = async (
  mat,
  materialData,
  balanceData,
  plantId,
  db,
  transactionType,
  trxNo,
  parentTrxNo
) => {
  try {
    let unitPrice = 0;
    let totalPrice = 0;

    if (materialData.material_costing_method === "Weighted Average") {
      const waQuery =
        materialData.item_batch_management == "1" && balanceData.batch_id
          ? db.collection("wa_costing_method").where({
              material_id: materialData.id,
              batch_id: balanceData.batch_id,
              plant_id: plantId,
            })
          : db.collection("wa_costing_method").where({
              material_id: materialData.id,
              plant_id: plantId,
            });

      const waResult = await waQuery.get();
      if (!waResult.data || waResult.data.length === 0) {
        throw new Error(
          `No Weighted Average costing data found for material_id: ${materialData.id}`
        );
      }

      const waRecord = waResult.data[0];
      if (waRecord.wa_quantity < mat.material_actual_qty) {
        throw new Error(
          `Insufficient WA quantity for material_id: ${materialData.id}, required: ${mat.material_actual_qty}, available: ${waRecord.wa_quantity}`
        );
      }

      const newWaQuantity = waRecord.wa_quantity - mat.material_actual_qty;
      await db.collection("wa_costing_method").doc(waRecord.id).update({
        wa_quantity: newWaQuantity,
        update_time: new Date().toISOString(),
        update_user: currentUser,
      });

      unitPrice = waRecord.wa_cost_price || 0;
      totalPrice = unitPrice * mat.material_actual_qty;
      unitPrice = Math.round(unitPrice * 10000) / 10000;
      totalPrice = Math.round(totalPrice * 10000) / 10000;
    } else if (materialData.material_costing_method === "First In First Out") {
      const fifoQuery =
        materialData.item_batch_management == "1" && balanceData.batch_id
          ? db.collection("fifo_costing_history").where({
              material_id: materialData.id,
              batch_id: balanceData.batch_id,
            })
          : db.collection("fifo_costing_history").where({
              material_id: materialData.id,
            });

      const fifoResult = await fifoQuery.get();
      if (!fifoResult.data || fifoResult.data.length === 0) {
        throw new Error(
          `No FIFO costing history found for material_id: ${materialData.id}`
        );
      }

      // Sort records client-side by fifo_sequence in ascending order
      const sortedRecords = fifoResult.data.sort(
        (a, b) => a.fifo_sequence - b.fifo_sequence
      );

      let remainingQty = mat.material_actual_qty;
      let totalCost = 0;

      for (const fifoRecord of sortedRecords) {
        if (remainingQty <= 0) break;

        const availableQty = fifoRecord.fifo_available_quantity || 0;
        const qtyToDeduct = Math.min(availableQty, remainingQty);
        if (qtyToDeduct > 0) {
          const newAvailableQty = availableQty - qtyToDeduct;
          await db
            .collection("fifo_costing_history")
            .doc(fifoRecord.id)
            .update({
              fifo_available_quantity: newAvailableQty,
              update_time: new Date().toISOString(),
              update_user: currentUser,
            });

          totalCost += qtyToDeduct * (fifoRecord.fifo_cost_price || 0);
          remainingQty -= qtyToDeduct;
        }
      }

      if (remainingQty > 0) {
        throw new Error(
          `Insufficient FIFO quantity for material_id: ${materialData.id}, remaining: ${remainingQty}`
        );
      }

      unitPrice = totalCost / mat.material_actual_qty;
      totalPrice = totalCost;
      unitPrice = Math.round(unitPrice * 10000) / 10000;
      totalPrice = Math.round(totalPrice * 10000) / 10000;
    } else if (materialData.material_costing_method === "Fixed Cost") {
      unitPrice = materialData.purchase_unit_price;
      totalPrice = unitPrice * mat.material_actual_qty;
    }

    const movement = {
      transaction_type: transactionType,
      trx_no: trxNo,
      parent_trx_no: parentTrxNo,
      movement:
        transactionType === "SM" && materialData.id === allData.material_id
          ? "IN"
          : "OUT",
      unit_price: unitPrice,
      total_price: totalPrice,
      quantity: mat.material_actual_qty || 0,
      item_id: materialData.id,
      inventory_category: "Reserved",
      uom_id: materialData.based_uom,
      base_qty: mat.material_actual_qty || 0,
      base_uom_id: materialData.based_uom,
      bin_location_id: mat.bin_location_id,
      batch_number_id:
        materialData.item_batch_management === "1"
          ? mat.batch_id || null
          : null,
      costing_method_id: materialData.material_costing_method,
      created_at: new Date().toISOString(),
      plant_id: allData.plant_id,
      organization_id: organizationId,
      update_time: new Date().toISOString(),
      is_deleted: 0,
    };

    const movementResult = await db
      .collection("inventory_movement")
      .add(movement);
    console.log(
      `Inventory movement record created with ID: ${movementResult.id}, unit_price: ${unitPrice}, total_price: ${totalPrice}`
    );

    return { unitPrice, totalPrice };
  } catch (error) {
    console.error(
      `Error calculating costing for material_id: ${materialData.id}:`,
      error
    );
    throw error;
  }
};

const updateOutputCosting = async (data, unitPrice, db) => {
  try {
    const roundedUnitPrice = Math.round(unitPrice * 10000) / 10000;
    const itemQuery = await db
      .collection("Item")
      .where({ id: data.material_id, is_deleted: 0 })
      .get();
    if (!itemQuery.data || itemQuery.data.length === 0) {
      throw new Error(`Item not found for material_id: ${data.material_id}`);
    }

    const item = itemQuery.data[0];
    const collectionName =
      item.item_batch_management === 1 ? "item_batch_balance" : "item_balance";

    const balanceQuery = await db
      .collection(collectionName)
      .where({
        material_id: data.material_id,
        plant_id: data.plant_id,
        location_id: data.target_bin_location,
        ...(item.item_batch_management === 1
          ? { batch_id: data.batch_id || null }
          : {}),
      })
      .get();

    if (!balanceQuery.data || balanceQuery.data.length === 0) {
      throw new Error(
        `No balance record found for material_id: ${data.material_id}`
      );
    }

    const balanceData = balanceQuery.data[0];

    if (item.material_costing_method === "Weighted Average") {
      const waQuery =
        item.item_batch_management == "1" && balanceData.batch_id
          ? db.collection("wa_costing_method").where({
              material_id: data.material_id,
              batch_id: balanceData.batch_id,
              plant_id: data.plant_id,
            })
          : db.collection("wa_costing_method").where({
              material_id: data.material_id,
              plant_id: data.plant_id,
            });

      const waResult = await waQuery.get();
      let waRecordId;
      let newWaQuantity;
      let newWaCostPrice;

      if (!waResult.data || waResult.data.length === 0) {
        newWaQuantity = data.yield_qty;
        newWaCostPrice = roundedUnitPrice;
        const newWaRecord = {
          material_id: data.material_id,
          plant_id: data.plant_id,
          wa_quantity: newWaQuantity,
          wa_cost_price: newWaCostPrice,
          update_time: new Date().toISOString(),
          is_deleted: 0,
          ...(item.item_batch_management === 1
            ? { batch_id: balanceData.batch_id || null }
            : {}),
        };
        const waResult = await db
          .collection("wa_costing_method")
          .add(newWaRecord);
        waRecordId = waResult.id;
        console.log(
          `Created new WA costing record ID: ${waRecordId}, wa_quantity: ${newWaQuantity}, wa_cost_price: ${newWaCostPrice}`
        );
      } else {
        const waRecord = waResult.data[0];
        waRecordId = waRecord.id;
        const existingWaQuantity = waRecord.wa_quantity || 0;
        const existingWaCost = waRecord.wa_cost_price || 0;
        newWaQuantity = existingWaQuantity + data.yield_qty;
        newWaCostPrice =
          Math.round(
            ((existingWaQuantity * existingWaCost +
              data.yield_qty * roundedUnitPrice) /
              newWaQuantity) *
              10000
          ) / 10000;

        await db
          .collection("wa_costing_method")
          .doc(waRecordId)
          .update({
            wa_quantity: newWaQuantity,
            wa_cost_price: Number(newWaCostPrice),
            update_time: new Date().toISOString(),
          });
        console.log(
          `Updated WA costing record ID: ${waRecordId}, new wa_quantity: ${newWaQuantity}, new wa_cost_price: ${newWaCostPrice}`
        );
      }
    } else if (item.material_costing_method === "First In First Out") {
      const fifoQuery =
        item.item_batch_management == "1" && balanceData.batch_id
          ? db.collection("fifo_costing_history").where({
              material_id: data.material_id,
              batch_id: balanceData.batch_id,
            })
          : db.collection("fifo_costing_history").where({
              material_id: data.material_id,
            });

      const fifoResponse = await fifoQuery.get();
      let sequenceNumber = 1;
      if (
        fifoResponse.data &&
        Array.isArray(fifoResponse.data) &&
        fifoResponse.data.length > 0
      ) {
        const existingSequences = fifoResponse.data.map((doc) =>
          parseInt(doc.fifo_sequence || 0)
        );
        sequenceNumber = Math.max(...existingSequences, 0) + 1;
      }
      console.log(
        `Latest FIFO sequence for material_id: ${data.material_id} is ${
          sequenceNumber - 1
        } ${String(sequenceNumber)}`
      );

      const newFifoRecord = {
        material_id: data.material_id,
        fifo_sequence: String(sequenceNumber),
        fifo_available_quantity: data.yield_qty,
        fifo_cost_price: roundedUnitPrice,
        plant_id: data.plant_id,
        fifo_initial_quantity: data.yield_qty,
        organization_id: organizationId,
        created_at: new Date().toISOString(),
        update_time: new Date().toISOString(),
        is_deleted: 0,
        ...(item.item_batch_management === 1
          ? { batch_id: balanceData.batch_id || null }
          : {}),
      };

      const fifoResultAdd = await db
        .collection("fifo_costing_history")
        .add(newFifoRecord);
      console.log(
        `Added new FIFO costing record ID: ${fifoResultAdd.id}, sequence: ${newFifoRecord.fifo_sequence}, quantity: ${data.yield_qty}, cost_price: ${roundedUnitPrice}`
      );
    } else {
      throw new Error(
        `Unsupported costing method: ${item.material_costing_method} for material_id: ${data.material_id}`
      );
    }
  } catch (error) {
    console.error(
      `Error updating costing for output material_id: ${data.material_id}:`,
      error
    );
    throw error;
  }
};

// Helper function to create proper balance_index structure
const createBalanceIndexForStockMovement = (materials) => {
  return materials.map((mat) => ({
    material_id: mat.material_id,
    sm_quantity: mat.material_actual_qty,
    location_id: mat.bin_location_id,
    batch_id: mat.batch_id || null,
  }));
};

const handleInventoryBalanceAndMovement = async (
  data,
  productionOrderNo,
  stockMovementNo,
  stockMovementGINo
) => {
  try {
    let totalInputCost = 0;

    // Process consumed items (table_mat_confirmation)
    for (const mat of data.table_mat_confirmation) {
      console.log(
        "Processing consumed material_id:",
        mat.material_id,
        "Quantity:",
        mat.material_actual_qty
      );

      const matItemQuery = await db
        .collection("Item")
        .where({ id: mat.material_id, is_deleted: 0 })
        .get();
      if (!matItemQuery.data || matItemQuery.data.length === 0) {
        throw new Error("Item not found for material_id: " + mat.material_id);
      }

      const matItem = matItemQuery.data[0];
      const matBatchManagement = matItem.item_batch_management;
      const matCollectionName =
        matBatchManagement === 1 ? "item_batch_balance" : "item_balance";

      if (matBatchManagement === 1) {
        const batchBalances =
          data.balance_index?.filter(
            (balance) =>
              balance.material_id === mat.material_id && balance.sm_quantity > 0
          ) || [];
        if (!batchBalances.length) {
          throw new Error(
            `No batch balance records found for material_id: ${mat.material_id}`
          );
        }

        let remainingQty = mat.material_actual_qty;
        const processedBatches = [];

        // Process specified batches from balance_index
        for (const batch of batchBalances) {
          if (remainingQty <= 0) break;

          const matBalanceQuery = await db
            .collection(matCollectionName)
            .where({
              material_id: mat.material_id,
              plant_id: data.plant_id,
              location_id: mat.bin_location_id,
              batch_id: batch.batch_id,
            })
            .get();
          if (!matBalanceQuery.data || matBalanceQuery.data.length === 0) {
            throw new Error(
              `No balance record found for material_id: ${mat.material_id}, batch_id: ${batch.batch_id}`
            );
          }

          const matBalance = matBalanceQuery.data[0];
          const availableQty = matBalance.reserved_qty || 0;
          const qtyToDeduct = Math.min(
            availableQty,
            remainingQty,
            batch.sm_quantity || 0
          );
          if (qtyToDeduct <= 0) continue;

          if (availableQty < qtyToDeduct) {
            throw new Error(
              `Insufficient stock for material_id: ${mat.material_id}, batch_id: ${batch.batch_id}, required: ${qtyToDeduct}, available: ${availableQty}`
            );
          }

          const { unitPrice, totalPrice } =
            await calculateCostingAndUpdateTables(
              {
                ...mat,
                material_actual_qty: qtyToDeduct,
                batch_id: batch.batch_id,
              },
              matItem,
              matBalance,
              data.plant_id,
              db,
              "SM",
              stockMovementGINo,
              productionOrderNo
            );

          totalInputCost += totalPrice;

          const updatedMatQuantities = {
            balance_quantity: parseFloat(
              (
                (matBalance.balance_quantity || 0) - mat.material_actual_qty
              ).toFixed(3)
            ),
            reserved_qty: parseFloat(
              (
                (matBalance.reserved_qty || 0) - mat.material_required_qty
              ).toFixed(3)
            ),
            unrestricted_qty: parseFloat(
              (
                (matBalance.unrestricted_qty || 0) +
                (mat.material_required_qty - mat.material_actual_qty)
              ).toFixed(3)
            ),
            update_time: new Date().toISOString(),
          };

          await db
            .collection(matCollectionName)
            .doc(matBalance.id)
            .update(updatedMatQuantities);
          console.log(
            `Balance record updated for ID: ${matBalance.id}, batch_id: ${batch.batch_id}, deducted: ${mat.material_actual_qty}`
          );

          remainingQty -= qtyToDeduct;
          processedBatches.push(batch.batch_id);
        }

        // If remainingQty > 0, fetch additional batches
        if (remainingQty > 0) {
          const additionalBatchesQuery = await db
            .collection(matCollectionName)
            .where({
              material_id: mat.material_id,
              plant_id: data.plant_id,
              location_id: mat.bin_location_id,
            })
            .get();

          if (
            !additionalBatchesQuery.data ||
            additionalBatchesQuery.data.length === 0
          ) {
            throw new Error(
              `No additional batch balance records found for material_id: ${mat.material_id} to cover remaining: ${remainingQty}`
            );
          }

          const additionalBatches = additionalBatchesQuery.data.filter(
            (batch) => !processedBatches.includes(batch.batch_id)
          );

          for (const matBalance of additionalBatches) {
            if (remainingQty <= 0) break;

            const availableQty = matBalance.reserved_qty || 0;
            const qtyToDeduct = Math.min(availableQty, remainingQty);
            if (qtyToDeduct <= 0) continue;

            if (availableQty < qtyToDeduct) {
              throw new Error(
                `Insufficient stock for material_id: ${mat.material_id}, batch_id: ${matBalance.batch_id}, required: ${mat.material_actual_qty}, available: ${availableQty}`
              );
            }

            const { unitPrice, totalPrice } =
              await calculateCostingAndUpdateTables(
                {
                  ...mat,
                  material_actual_qty: qtyToDeduct,
                  batch_id: matBalance.batch_id,
                },
                matItem,
                matBalance,
                data.plant_id,
                db,
                "SM",
                stockMovementGINo,
                productionOrderNo
              );

            totalInputCost += totalPrice;

            const updatedMatQuantities = {
              balance_quantity: parseFloat(
                (
                  (matBalance.balance_quantity || 0) - mat.material_actual_qty
                ).toFixed(3)
              ),
              reserved_qty: parseFloat(
                (
                  (matBalance.reserved_qty || 0) - mat.material_required_qty
                ).toFixed(3)
              ),
              unrestricted_qty: parseFloat(
                (
                  (matBalance.unrestricted_qty || 0) +
                  (mat.material_required_qty - mat.material_actual_qty)
                ).toFixed(3)
              ),
              update_time: new Date().toISOString(),
            };

            await db
              .collection(matCollectionName)
              .doc(matBalance.id)
              .update(updatedMatQuantities);
            console.log(
              `Balance record updated for ID: ${matBalance.id}, batch_id: ${matBalance.batch_id}, deducted: ${qtyToDeduct}`
            );

            remainingQty -= qtyToDeduct;
          }

          if (remainingQty > 0) {
            throw new Error(
              `Insufficient batch quantities for material_id: ${mat.material_id}, remaining: ${remainingQty}`
            );
          }
        }

        const resOnReserve = await db
          .collection("on_reserved_gd")
          .where({
            parent_no: productionOrderNo,
            organization_id: data.organization_id,
            is_deleted: 0,
            material_id: mat.material_id,
            batch_id: mat.batch_id,
            bin_location: mat.bin_location_id,
          })
          .get();

        if (!resOnReserve || resOnReserve.data.length === 0)
          throw new Error("Error fetching on reserve table.");

        const onReserveData = resOnReserve.data[0];

        await db.collection("on_reserved_gd").doc(onReserveData.id).update({
          delivered_qty: mat.material_required_qty,
          open_qty: 0,
          doc_no: stockMovementGINo,
        });
      } else {
        const matBalanceQuery = await db
          .collection(matCollectionName)
          .where({
            material_id: mat.material_id,
            plant_id: data.plant_id,
            location_id: mat.bin_location_id,
          })
          .get();
        if (!matBalanceQuery.data || matBalanceQuery.data.length === 0) {
          throw new Error(
            `No balance record found for material_id: ${mat.material_id}`
          );
        }

        const matBalance = matBalanceQuery.data[0];
        if (matBalance.reserved_qty < mat.material_actual_qty) {
          throw new Error(
            `Insufficient stock for material_id: ${mat.material_id}`
          );
        }

        const { unitPrice, totalPrice } = await calculateCostingAndUpdateTables(
          mat,
          matItem,
          matBalance,
          data.plant_id,
          db,
          "SM",
          stockMovementGINo,
          productionOrderNo
        );

        totalInputCost += totalPrice;

        const updatedMatQuantities = {
          balance_quantity: parseFloat(
            (
              (matBalance.balance_quantity || 0) -
              (mat.material_actual_qty || 0)
            ).toFixed(3)
          ),
          reserved_qty: parseFloat(
            (
              (matBalance.reserved_qty || 0) - (mat.material_required_qty || 0)
            ).toFixed(3)
          ),
          unrestricted_qty: parseFloat(
            (
              (matBalance.unrestricted_qty || 0) +
              (mat.material_required_qty - mat.material_actual_qty)
            ).toFixed(3)
          ),
          update_time: new Date().toISOString(),
        };

        await db
          .collection(matCollectionName)
          .doc(matBalance.id)
          .update(updatedMatQuantities);
        console.log(`Balance record updated for ID: ${matBalance.id}`);

        const resOnReserve = await db
          .collection("on_reserved_gd")
          .where({
            parent_no: productionOrderNo,
            organization_id: data.organization_id,
            is_deleted: 0,
            material_id: mat.material_id,
            bin_location: mat.bin_location_id,
          })
          .get();

        if (!resOnReserve || resOnReserve.data.length === 0)
          throw new Error("Error fetching on reserve table.");

        const onReserveData = resOnReserve.data[0];

        await db.collection("on_reserved_gd").doc(onReserveData.id).update({
          delivered_qty: mat.material_required_qty,
          open_qty: 0,
          doc_no: stockMovementGINo,
        });
      }
    }

    // Process produced item
    const itemQuery = await db
      .collection("Item")
      .where({ id: data.material_id, is_deleted: 0 })
      .get();
    if (!itemQuery.data || itemQuery.data.length === 0) {
      throw new Error("Item not found for material_id: " + data.material_id);
    }

    const item = itemQuery.data[0];
    const item_batch_management = item.item_batch_management;
    const collectionName =
      item_batch_management === 1 ? "item_batch_balance" : "item_balance";
    let producedBatchId = data.batch_id;

    if (item_batch_management === 1) {
      const batchData = {
        batch_number: data.batch_id || "",
        material_id: data.material_id,
        initial_quantity: data.yield_qty,
        plant_id: data.plant_id,
        parent_transaction_no: productionOrderNo,
        transaction_no: stockMovementNo,
        organization_id: organizationId,
        created_at: new Date(),
        create_user: data.create_user || currentUser,
      };
      await db.collection("batch").add(batchData);
      const resBatch = await db
        .collection("batch")
        .where({ batch_number: producedBatchId })
        .get();
      if (resBatch && resBatch.data.length > 0) {
        producedBatchId = await resBatch.data[0].id;
      }
      console.log(`Created new batch record with ID: ${producedBatchId}`);
    }

    const categoryField = categoryMap[data.category];
    if (!categoryField) {
      throw new Error("Invalid category: " + data.category);
    }

    const balanceQuery = await db
      .collection(collectionName)
      .where({
        material_id: data.material_id,
        plant_id: data.plant_id,
        location_id: data.target_bin_location,
        ...(item_batch_management === 1
          ? { batch_id: producedBatchId || null }
          : {}),
      })
      .get();

    if (!balanceQuery.data || balanceQuery.data.length === 0) {
      const newBalanceData = {
        material_id: data.material_id,
        plant_id: data.plant_id,
        location_id: data.target_bin_location,
        balance_quantity: data.yield_qty || 0,
        [categoryField]: data.yield_qty || 0,
        unrestricted_qty:
          data.category === "Unrestricted" ? data.yield_qty || 0 : 0,
        qualityinsp_qty:
          data.category === "Quality Inspection" ? data.yield_qty || 0 : 0,
        block_qty: data.category === "Blocked" ? data.yield_qty || 0 : 0,
        reserved_qty: data.category === "Reserved" ? data.yield_qty || 0 : 0,
        intransit_qty: data.category === "In Transit" ? data.yield_qty || 0 : 0,
        create_time: new Date().toISOString(),
        update_time: new Date().toISOString(),
        organization_id: organizationId,
        ...(item_batch_management === 1
          ? { batch_id: producedBatchId || null }
          : {}),
        is_deleted: 0,
      };

      const balanceResult = await db
        .collection(collectionName)
        .add(newBalanceData);
      console.log(
        `New balance record created in ${collectionName} with ID: ${balanceResult.id}`
      );
    } else {
      const existingBalance = balanceQuery.data[0];
      const updatedQuantities = {
        balance_quantity:
          (existingBalance.balance_quantity || 0) + (data.yield_qty || 0),
        [categoryField]:
          (existingBalance[categoryField] || 0) + (data.yield_qty || 0),
        update_time: new Date().toISOString(),
      };

      await db
        .collection(collectionName)
        .doc(existingBalance.id)
        .update(updatedQuantities);
      console.log(`Balance record updated for ID: ${existingBalance.id}`);
    }

    const outputUnitPrice =
      data.yield_qty > 0 ? totalInputCost / data.yield_qty : 0;
    const roundedOutputUnitPrice = Math.round(outputUnitPrice * 10000) / 10000;

    const inMovement = {
      transaction_type: "SM",
      trx_no: stockMovementNo,
      parent_trx_no: productionOrderNo,
      movement: "IN",
      unit_price: roundedOutputUnitPrice,
      total_price:
        Math.round(roundedOutputUnitPrice * (data.yield_qty || 0) * 10000) /
        10000,
      quantity: data.yield_qty || 0,
      item_id: data.material_id,
      inventory_category: data.category,
      uom_id: data.planned_qty_uom,
      base_qty: data.yield_qty || 0,
      base_uom_id: data.planned_qty_uom,
      bin_location_id: data.target_bin_location,
      batch_number_id:
        item_batch_management === 1 ? producedBatchId || null : null,
      costing_method_id: item.material_costing_method,
      created_at: new Date().toISOString(),
      plant_id: data.plant_id,
      organization_id: organizationId,
      update_time: new Date().toISOString(),
      is_deleted: 0,
    };

    const movementResult = await db
      .collection("inventory_movement")
      .add(inMovement);
    console.log(
      `Inventory movement record created for produced item with ID: ${movementResult.id}`
    );

    const resSM = await db
      .collection("stock_movement")
      .where({
        stock_movement_no: stockMovementNo,
        organization_id: organizationId,
        is_deleted: 0,
      })
      .get();

    if (!resSM || resSM.data.length > 0) {
      const smData = resSM.data[0];
      await db
        .collection("stock_movement_d2c7o1jd_sub")
        .where({
          stock_movement_id: smData.id,
          is_deleted: 0,
        })
        .update({ unit_price: roundedOutputUnitPrice });
    }

    await updateOutputCosting(
      { ...data, batch_id: producedBatchId },
      roundedOutputUnitPrice,
      db
    );
  } catch (error) {
    console.error("Error handling inventory balance and movement:", error);
    throw error;
  }
};

// Check if stock movements already exist for this production order
const checkExistingStockMovements = async (productionOrderId, db) => {
  const existingMovements = await db
    .collection("stock_movement")
    .where({
      production_order_id: productionOrderId,
      is_deleted: 0,
    })
    .get();

  if (existingMovements.data && existingMovements.data.length > 0) {
    const movements = existingMovements.data.reduce((acc, mov) => {
      if (mov.movement_type === MOVEMENT_TYPES.PRODUCTION_RECEIPT) {
        acc.pr = mov;
      } else if (mov.movement_type === MOVEMENT_TYPES.GOODS_ISSUE) {
        acc.gi = mov;
      }
      return acc;
    }, {});

    return movements;
  }

  return null;
};

const generateBatchNumber = async (batch_id, organizationId) => {
  try {
    if (batch_id === "Auto-generated batch number") {
      const resBatchConfig = await db
        .collection("batch_level_config")
        .where({ organization_id: organizationId })
        .get();

      if (resBatchConfig && resBatchConfig.data.length > 0) {
        const batchConfigData = resBatchConfig.data[0];

        let batchPrefix = batchConfigData.batch_prefix || "";
        if (batchPrefix) batchPrefix += "-";

        const generatedBatchNo =
          batchPrefix +
          String(batchConfigData.batch_running_number).padStart(10, "0");

        await db
          .collection("batch_level_config")
          .where({ id: batchConfigData.id })
          .update({
            batch_running_number: batchConfigData.batch_running_number + 1,
          });

        return generatedBatchNo;
      }
    } else {
      return batch_id;
    }
  } catch (error) {
    throw new Error(error);
  }
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
          `Cannot update last transaction date for item #${index + 1}.`
        );
      }
    }
  } catch (error) {
    throw new Error(error);
  }
};

const createICTPStockMovement = async (allData, productionOrderNo) => {
  try {
    const unusedQuantity = allData.table_mat_confirmation.filter(
      (item) => item.material_required_qty - item.material_actual_qty > 0
    );

    // generate ICTP prefix
    const generateICTPPrefix = async () => {
      const prefixEntryQuery = await db
        .collection("prefix_configuration")
        .where({
          document_types: "Stock Movement",
          movement_type: "Inventory Category Transfer Posting",
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

      const checkUniqueness = async (generatedPrefix, organizationId) => {
        const existingDoc = await db
          .collection("stock_movement")
          .where({
            stock_movement_no: generatedPrefix,
            organization_id: organizationId,
          })
          .get();
        return !existingDoc.data || existingDoc.data.length === 0;
      };

      let prefixToShow;
      while (!isUnique && attempts < maxAttempts) {
        attempts++;
        prefixToShow = generatePrefix(runningNumber);
        isUnique = await checkUniqueness(prefixToShow, organizationId);
        if (!isUnique) runningNumber++;
      }

      if (!isUnique) {
        throw new Error(
          "Could not generate a unique Stock Movement number after maximum attempts"
        );
      }

      await db
        .collection("prefix_configuration")
        .doc(prefixData.id)
        .update({ running_number: runningNumber + 1, has_record: 1 });

      return prefixToShow;
    };

    const convertUOM = async (materialData, mat) => {
      let baseQTY = 0;
      let matQTY = mat.material_required_qty - mat.material_actual_qty;

      if (mat.material_uom === materialData.based_uom) baseQTY = matQTY;
      else {
        if (materialData.table_uom_conversion.length > 0) {
          for (const uom of materialData.table_uom_conversion) {
            if (mat.material_uom === uom.alt_uom_id) {
              baseQTY = parseFloat(
                (parseFloat(matQTY) * uom.base_qty).toFixed(3)
              );
            }
          }
        } else baseQTY = matQTY;
      }

      return baseQTY;
    };

    const createInventoryMovement = async (mat, allData, prefix) => {
      const resItem = await db.collection("Item").doc(mat.material_id).get();

      if (!resItem || resItem.data.length === 0)
        throw new Error("Error fetching item data when create ICTP.");

      const materialData = resItem.data[0];

      const baseQTY = await convertUOM(materialData, mat);

      const inventoryMovementOUTData = {
        transaction_type: "SM",
        trx_no: prefix,
        parent_trx_no: productionOrderNo,
        movement: "OUT",
        unit_price: 0,
        total_price: 0,
        quantity: mat.material_required_qty - mat.material_actual_qty || 0,
        item_id: mat.material_id,
        inventory_category: "Reserved",
        uom_id: mat.material_uom,
        base_qty: baseQTY || 0,
        base_uom_id: materialData.based_uom,
        bin_location_id: mat.bin_location_id,
        batch_number_id:
          materialData.item_batch_management === "1"
            ? mat.batch_id || null
            : null,
        costing_method_id: materialData.material_costing_method,
        created_at: new Date().toISOString(),
        plant_id: allData.plant_id,
        organization_id: allData.organization_id,
        update_time: new Date().toISOString(),
        is_deleted: 0,
      };

      const inventoryMovementINData = {
        transaction_type: "SM",
        trx_no: prefix,
        parent_trx_no: productionOrderNo,
        movement: "IN",
        unit_price: 0,
        total_price: 0,
        quantity: mat.material_required_qty - mat.material_actual_qty || 0,
        item_id: mat.material_id,
        inventory_category: "Unrestricted",
        uom_id: mat.material_uom,
        base_qty: baseQTY || 0,
        base_uom_id: materialData.based_uom,
        bin_location_id: mat.bin_location_id,
        batch_number_id:
          materialData.item_batch_management === "1"
            ? mat.batch_id || null
            : null,
        costing_method_id: materialData.material_costing_method,
        created_at: new Date().toISOString(),
        plant_id: allData.plant_id,
        organization_id: allData.organization_id,
        update_time: new Date().toISOString(),
        is_deleted: 0,
      };

      await Promise.all([
        db.collection("inventory_movement").add(inventoryMovementOUTData),
        db.collection("inventory_movement").add(inventoryMovementINData),
      ]);

      const resOnReserve = await db
        .collection("on_reserved_gd")
        .where({
          parent_no: allData.production_order_no,
          organization_id: allData.organization_id,
          is_deleted: 0,
          material_id: mat.material_id,
          batch_id: mat.batch_id,
          bin_location: mat.bin_location_id,
        })
        .get();

      if (!resOnReserve || resOnReserve.data.length === 0)
        throw new Error("Error fetching on reserve table.");

      const onReserveData = resOnReserve.data[0];

      await db.collection("on_reserved_gd").doc(onReserveData.id).update({
        doc_no: prefix,
      });
    };

    if (unusedQuantity.length > 0) {
      const ICTPPrefix = await generateICTPPrefix();

      let stockMovementData = [];
      for (const mat of unusedQuantity) {
        let stockSummary = "";

        const resUOM = await db
          .collection("unit_of_measurement")
          .where({ id: mat.material_uom })
          .get();
        const uomName = resUOM?.data[0] ? resUOM.data[0].uom_name : "";

        const resBinLocation = await db
          .collection("bin_location")
          .where({ id: mat.bin_location_id })
          .get();
        const binLocationName = resBinLocation?.data[0]
          ? resBinLocation.data[0].bin_location_combine
          : "";

        const batchId = mat.batch_id;

        let batchNumber = "";
        if (batchId) {
          const resBatch = await db
            .collection("batch")
            .where({ id: batchId })
            .get();
          batchNumber = resBatch?.data[0]
            ? `\n[${resBatch.data[0].batch_number}]`
            : "";
        }

        stockSummary = `Total: ${
          mat.material_required_qty - mat.material_actual_qty
        } ${uomName}\n\nDETAILS:\n1. ${binLocationName}: ${
          mat.material_required_qty - mat.material_actual_qty
        } ${uomName} (RES -> UNR)${batchNumber}`;

        const smLineItemData = {
          item_selection: mat.material_id,
          item_name: mat.material_name,
          item_desc: mat.material_desc,
          quantity_uom: mat.material_uom || "",
          total_quantity: mat.material_required_qty - mat.material_actual_qty,
          stock_summary: stockSummary || "",
        };

        stockMovementData.push(smLineItemData);

        await createInventoryMovement(mat, allData, ICTPPrefix);
      }

      const ICTPData = {
        movement_type: "Inventory Category Transfer Posting",
        stock_movement_no: ICTPPrefix || null,
        movement_reason: "",
        stock_movement_status: "Completed",
        issued_by: this.getVarGlobal("nickname"),
        issue_date: new Date(),
        issuing_operation_faci: allData.plant_id,
        stock_movement: stockMovementData,
        balance_index: allData.balance_index || [],
        is_production_order: 1,
        production_order_id: allData.id,
        organization_id: allData.organization_id,
        is_deleted: 0,
        create_time: new Date(),
        update_time: new Date(),
      };

      await db.collection("stock_movement").add(ICTPData);
    }
  } catch (error) {
    throw new Error(error);
  }
};

// Main execution - Always in Edit mode
try {
  console.log(
    "Starting Edit operation for production order ID:",
    productionOrderId
  );

  this.showLoading();

  if (!productionOrderId) {
    throw new Error("Production order ID is required for edit operation");
  }

  validateData(allData);
  await preCheckMaterialQuantities(allData);

  allData.batch_id = await generateBatchNumber(
    allData.batch_id,
    organizationId
  );

  const entry = createEntry(allData);

  await db.collection("production_order").doc(productionOrderId).update(entry);
  await updateItemTransactionDate(entry);

  const properBalanceIndex = createBalanceIndexForStockMovement(
    allData.table_mat_confirmation
  );

  const stockMovementData = {
    id: productionOrderId,
    created_at: new Date(),
    tenant_id: allData.tenant_id,
    plant_id: allData.plant_id,
    balance_index: properBalanceIndex,
    organization_id: organizationId,
    issued_by: currentUser,
  };

  let prStockMovementNo = null;
  const prStockMovementResult = await createStockMovement(
    stockMovementData,
    organizationId,
    db,
    self,
    {
      material_id: allData.material_id,
      material_name: allData.material_name,
      material_desc: allData.material_desc,
      yield_qty: allData.yield_qty,
      target_bin_location: allData.target_bin_location,
      category: allData.category,
      batch_id: allData.batch_id,
    },
    MOVEMENT_TYPES.PRODUCTION_RECEIPT,
    "Production Order - Production Receipt"
  );
  prStockMovementNo = prStockMovementResult.stock_movement_no;

  let giStockMovementNo = null;
  if (
    allData.table_mat_confirmation &&
    allData.table_mat_confirmation.length > 0
  ) {
    const giStockMovementResult = await createStockMovement(
      stockMovementData,
      organizationId,
      db,
      self,
      allData.table_mat_confirmation,
      MOVEMENT_TYPES.GOODS_ISSUE,
      "Production Order - Good Issue"
    );
    giStockMovementNo = giStockMovementResult.stock_movement_no;
  }

  await handleInventoryBalanceAndMovement(
    allData,
    entry.production_order_no,
    prStockMovementNo,
    giStockMovementNo
  );

  await createICTPStockMovement(allData, entry.production_order_no);

  const soLineItem = entry.table_sales_order;
  const materialId = entry.material_id;

  if (soLineItem.length > 0) {
    soLineItem.forEach(async (item) => {
      try {
        console.log("soLineItem", soLineItem);
        const resSO = await db
          .collection("sales_order")
          .where({ id: item.sales_order_id })
          .get();

        if (resSO && resSO.data.length > 0) {
          const soData = resSO.data[0];
          const tableSO = soData.table_so;

          for (const soItem of tableSO) {
            if (soItem.item_name === materialId) {
              if (
                !soItem.production_status ||
                soItem.production_status !== "Completed"
              ) {
                soItem.production_qty += item.production_qty;

                if (soItem.production_qty >= soItem.so_quantity) {
                  soItem.production_status = "Completed";
                } else if (
                  soItem.production_qty < soItem.so_quantity &&
                  soItem.production_qty > 0
                ) {
                  soItem.production_status = "Partially";
                } else {
                  soItem.production_status = "";
                }

                break;
              }
            }
          }

          await db
            .collection("sales_order")
            .doc(item.sales_order_id)
            .update({ table_so: tableSO });
        }
      } catch (error) {
        this.$message.error("Cannot update Sales Order");
        throw error;
      }
    });
  }

  closeDialog();
} catch (error) {
  console.error("Edit operation failed:", error);
  this.hideLoading();
  throw error;
}
