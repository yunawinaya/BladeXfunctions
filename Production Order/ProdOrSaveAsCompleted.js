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
          .collection("item")
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

    const stockMovementItems = itemsArray.map((item) => {
      if (!item.material_id) {
        throw new Error(
          `Material ID is missing in item for stock movement (${movementTypeCode})`
        );
      }
      return {
        item_selection: item.material_id,
        requested_qty:
          item.yield_qty || item.quantity || item.material_actual_qty,
        received_quantity: item.yield_qty || 0,
        received_quantity_uom: allData.planned_qty_uom || "",
        total_quantity:
          item.yield_qty || item.quantity || item.material_actual_qty,
        location_id: item.target_bin_location || item.bin_location_id,
        category: item.category || null,
      };
    });

    const stockMovement = {
      movement_type: movementTypeCode,
      stock_movement_no: "",
      movement_reason: movementReasonName,
      stock_movement_status: "Completed",
      issued_by: stockMovementData.issued_by || currentUser,
      issue_date: stockMovementData.created_at || new Date(),
      tenant_id: stockMovementData.tenant_id || "000000",
      issuing_operation_faci: stockMovementData.plant_id || "000000",
      stock_movement: stockMovementItems,
      balance_index: balanceIndexData || [],
      is_production_order: 1,
      production_order_id: stockMovementData.id,
      organization_id: organizationId,
      is_deleted: 0,
      create_time: new Date(),
      update_time: new Date(),
    };

    const movementReasonQuery = await db
      .collection("stock_movement_reason")
      .where({ sm_reason_name: movementReasonName })
      .get();
    // stockMovement.movement_reason = movementReasonQuery.data && movementReasonQuery.data.length > 0 ? movementReasonQuery.data[0].id : "";

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
      .update({ running_number: runningNumber + 1 });

    self.setData({ stock_movement_no: prefixToShow });

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
    production_order_name: "Production order name",
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
      if (!mat.material_actual_qty) {
        errors.push(
          `Material quantity is missing in confirmation entry ${index + 1}`
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
        .collection("item")
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
          totalAvailable += balance.unrestricted_qty || 0;
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
    }

    const movement = {
      transaction_type: transactionType,
      trx_no: trxNo,
      parent_trx_no: parentTrxNo,
      movement:
        transactionType === "PRO" && materialData.id === allData.material_id
          ? "IN"
          : "OUT",
      unit_price: unitPrice,
      total_price: totalPrice,
      quantity: mat.material_actual_qty || 0,
      item_id: materialData.id,
      inventory_category:
        transactionType === "PRO" && materialData.id === allData.material_id
          ? allData.category
          : "Unrestricted",
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
      .collection("item")
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
    material_actual_qty: mat.material_actual_qty,
    bin_location_id: mat.bin_location_id,
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
        .collection("item")
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
          const availableQty = matBalance.unrestricted_qty || 0;
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
              "PRO",
              productionOrderNo,
              stockMovementGINo
            );

          totalInputCost += totalPrice;

          const updatedMatQuantities = {
            balance_quantity: (matBalance.balance_quantity || 0) - qtyToDeduct,
            unrestricted_qty: (matBalance.unrestricted_qty || 0) - qtyToDeduct,
            update_time: new Date().toISOString(),
          };

          await db
            .collection(matCollectionName)
            .doc(matBalance.id)
            .update(updatedMatQuantities);
          console.log(
            `Balance record updated for ID: ${matBalance.id}, batch_id: ${batch.batch_id}, deducted: ${qtyToDeduct}`
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
              unrestricted_qty: db.greaterThan(0),
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

            const availableQty = matBalance.unrestricted_qty || 0;
            const qtyToDeduct = Math.min(availableQty, remainingQty);
            if (qtyToDeduct <= 0) continue;

            if (availableQty < qtyToDeduct) {
              throw new Error(
                `Insufficient stock for material_id: ${mat.material_id}, batch_id: ${matBalance.batch_id}, required: ${qtyToDeduct}, available: ${availableQty}`
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
                "PRO",
                productionOrderNo,
                stockMovementGINo
              );

            totalInputCost += totalPrice;

            const updatedMatQuantities = {
              balance_quantity:
                (matBalance.balance_quantity || 0) - qtyToDeduct,
              unrestricted_qty:
                (matBalance.unrestricted_qty || 0) - qtyToDeduct,
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
        if (matBalance.unrestricted_qty < mat.material_actual_qty) {
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
          "PRO",
          productionOrderNo,
          stockMovementGINo
        );

        totalInputCost += totalPrice;

        const updatedMatQuantities = {
          balance_quantity:
            (matBalance.balance_quantity || 0) - (mat.material_actual_qty || 0),
          unrestricted_qty:
            (matBalance.unrestricted_qty || 0) - (mat.material_actual_qty || 0),
          update_time: new Date().toISOString(),
        };

        await db
          .collection(matCollectionName)
          .doc(matBalance.id)
          .update(updatedMatQuantities);
        console.log(`Balance record updated for ID: ${matBalance.id}`);
      }
    }

    // Process produced item
    const itemQuery = await db
      .collection("item")
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
        batch_number: data.batch_id || `BATCH-${productionOrderNo}`,
        material_id: data.material_id,
        initial_quantity: data.yield_qty,
        plant_id: data.plant_id,
        transaction_no: productionOrderNo,
        organization_id: organizationId,
        created_at: new Date(),
        create_user: data.create_user || currentUser,
      };
      const batchResult = await db.collection("batch").add(batchData);
      producedBatchId = batchResult.id;
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
      transaction_type: "PRO",
      trx_no: productionOrderNo,
      parent_trx_no: stockMovementNo,
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

// Main execution - Always in Edit mode
try {
  console.log(
    "Starting Edit operation for production order ID:",
    productionOrderId
  );

  if (!productionOrderId) {
    throw new Error("Production order ID is required for edit operation");
  }

  validateData(allData);
  await preCheckMaterialQuantities(allData);

  const entry = createEntry(allData);

  await db.collection("production_order").doc(productionOrderId).update(entry);

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
      yield_qty: allData.yield_qty,
      target_bin_location: allData.target_bin_location,
      category: allData.category,
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

  closeDialog();
} catch (error) {
  console.error("Edit operation failed:", error);
  throw error;
}
