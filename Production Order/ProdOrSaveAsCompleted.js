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
  serial_number_data: data.serial_number_data,
  is_serialized_item: data.is_serialized_item,
  is_single: data.is_single,
  is_auto: data.is_auto,
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
      const isSerializedItem = matItem.serial_number_management === 1;

      let totalAvailable = 0;

      if (isSerializedItem && mat.serial_number) {
        // For serialized items, check item_serial_balance
        const serialBalanceParams = {
          material_id: mat.material_id,
          serial_number: mat.serial_number,
          plant_id: data.plant_id,
          organization_id: data.organization_id,
        };

        if (matBatchManagement === 1 && mat.batch_id) {
          serialBalanceParams.batch_id = mat.batch_id;
        }

        if (mat.bin_location_id) {
          serialBalanceParams.location_id = mat.bin_location_id;
        }

        const serialBalanceQuery = await db
          .collection("item_serial_balance")
          .where(serialBalanceParams)
          .get();

        if (serialBalanceQuery.data && serialBalanceQuery.data.length > 0) {
          const serialBalance = serialBalanceQuery.data[0];
          totalAvailable = serialBalance.reserved_qty || 0;
        }
      } else {
        // For non-serialized items, use existing logic
        const matCollectionName =
          matBatchManagement === 1 ? "item_batch_balance" : "item_balance";

        const balanceQuery = await db
          .collection(matCollectionName)
          .where({
            material_id: mat.material_id,
            plant_id: data.plant_id,
            location_id: mat.bin_location_id,
          })
          .get();

        if (balanceQuery.data && balanceQuery.data.length > 0) {
          balanceQuery.data.forEach((balance) => {
            totalAvailable += balance.reserved_qty || 0;
          });
        }
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
  parentTrxNo,
  skipInventoryMovement = false
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

    // Skip inventory movement creation if requested (for serialized items handled by grouping)
    if (!skipInventoryMovement) {
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
    } else {
      console.log(
        `Skipped inventory movement creation for serialized item, unit_price: ${unitPrice}, total_price: ${totalPrice}`
      );
    }

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

// Helper functions for serial number processing
const roundQty = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(3));
};

const createSerialMovementRecord = async (
  inventoryMovementId,
  serialNumber,
  batchId,
  baseQty,
  baseUOM,
  plantId,
  organizationId
) => {
  const invSerialMovementRecord = {
    inventory_movement_id: inventoryMovementId,
    serial_number: serialNumber,
    batch_id: batchId || null,
    base_qty: roundQty(baseQty),
    base_uom: baseUOM,
    plant_id: plantId,
    organization_id: organizationId,
  };

  await db.collection("inv_serial_movement").add(invSerialMovementRecord);
  console.log(`Created inv_serial_movement for serial: ${serialNumber}`);
};

const updateSerialBalance = async (
  materialId,
  serialNumber,
  batchId,
  locationId,
  category,
  qtyChange,
  plantId,
  organizationId
) => {
  const categoryMap = {
    Unrestricted: "unrestricted_qty",
    "Quality Inspection": "qualityinsp_qty",
    Blocked: "block_qty",
    Reserved: "reserved_qty",
    "In Transit": "intransit_qty",
  };

  const serialBalanceParams = {
    material_id: materialId,
    serial_number: serialNumber,
    plant_id: plantId,
    organization_id: organizationId,
  };

  if (batchId) {
    serialBalanceParams.batch_id = batchId;
  }

  if (locationId) {
    serialBalanceParams.location_id = locationId;
  }

  const serialBalanceQuery = await db
    .collection("item_serial_balance")
    .where(serialBalanceParams)
    .get();

  if (!serialBalanceQuery.data || serialBalanceQuery.data.length === 0) {
    throw new Error(
      `No serial balance found for serial number: ${serialNumber}`
    );
  }

  const existingBalance = serialBalanceQuery.data[0];
  const categoryField = categoryMap[category] || "unrestricted_qty";

  const currentCategoryQty = roundQty(
    parseFloat(existingBalance[categoryField] || 0)
  );
  const currentBalanceQty = roundQty(
    parseFloat(existingBalance.balance_quantity || 0)
  );

  const newCategoryQty = roundQty(currentCategoryQty + qtyChange);
  const newBalanceQty = roundQty(currentBalanceQty + qtyChange);

  if (newCategoryQty < 0) {
    throw new Error(
      `Insufficient ${category} quantity for serial ${serialNumber}. Available: ${currentCategoryQty}, Requested: ${Math.abs(
        qtyChange
      )}`
    );
  }

  if (newBalanceQty < 0) {
    throw new Error(
      `Insufficient total quantity for serial ${serialNumber}. Available: ${currentBalanceQty}, Requested: ${Math.abs(
        qtyChange
      )}`
    );
  }

  const updateData = {
    [categoryField]: newCategoryQty,
    balance_quantity: newBalanceQty,
    update_time: new Date().toISOString(),
  };

  // Note: unused quantity processing moved to ICTP function

  await db
    .collection("item_serial_balance")
    .doc(existingBalance.id)
    .update(updateData);
  console.log(
    `Updated serial balance for ${serialNumber}: ${category}=${newCategoryQty}, Balance=${newBalanceQty}`
  );
};

const createOrUpdateReceivingSerialBalance = async (
  materialId,
  serialNumber,
  batchId,
  locationId,
  category,
  qtyChange,
  plantId,
  organizationId,
  materialUom
) => {
  const categoryMap = {
    Unrestricted: "unrestricted_qty",
    "Quality Inspection": "qualityinsp_qty",
    Blocked: "block_qty",
    Reserved: "reserved_qty",
    "In Transit": "intransit_qty",
  };

  const serialBalanceParams = {
    material_id: materialId,
    serial_number: serialNumber,
    location_id: locationId,
    plant_id: plantId,
    organization_id: organizationId,
  };

  if (batchId) {
    serialBalanceParams.batch_id = batchId;
  }

  const serialBalanceQuery = await db
    .collection("item_serial_balance")
    .where(serialBalanceParams)
    .get();

  const categoryField = categoryMap[category] || "unrestricted_qty";

  if (serialBalanceQuery.data && serialBalanceQuery.data.length > 0) {
    const existingBalance = serialBalanceQuery.data[0];
    const currentCategoryQty = roundQty(
      parseFloat(existingBalance[categoryField] || 0)
    );
    const currentBalanceQty = roundQty(
      parseFloat(existingBalance.balance_quantity || 0)
    );

    const newCategoryQty = roundQty(currentCategoryQty + qtyChange);
    const newBalanceQty = roundQty(currentBalanceQty + qtyChange);

    const updateData = {
      [categoryField]: newCategoryQty,
      balance_quantity: newBalanceQty,
      update_time: new Date().toISOString(),
    };

    await db
      .collection("item_serial_balance")
      .doc(existingBalance.id)
      .update(updateData);
    console.log(
      `Updated existing serial balance for ${serialNumber} at location ${locationId}`
    );
  } else {
    const serialBalanceRecord = {
      material_id: materialId,
      material_uom: materialUom,
      serial_number: serialNumber,
      batch_id: batchId || null,
      plant_id: plantId,
      location_id: locationId,
      unrestricted_qty: category === "Unrestricted" ? roundQty(qtyChange) : 0,
      block_qty: category === "Blocked" ? roundQty(qtyChange) : 0,
      reserved_qty: category === "Reserved" ? roundQty(qtyChange) : 0,
      qualityinsp_qty:
        category === "Quality Inspection" ? roundQty(qtyChange) : 0,
      intransit_qty: category === "In Transit" ? roundQty(qtyChange) : 0,
      balance_quantity: roundQty(qtyChange),
      organization_id: organizationId,
      create_time: new Date().toISOString(),
      update_time: new Date().toISOString(),
    };

    await db.collection("item_serial_balance").add(serialBalanceRecord);
    console.log(
      `Created new serial balance for ${serialNumber} at location ${locationId}`
    );
  }
};

const processSerializedItemForGoodIssue = async (
  mat,
  matItem,
  plantId,
  organizationId,
  movementId,
  productionOrderNo,
  stockMovementGINo
) => {
  console.log(
    `Processing serialized item for Good Issue: ${mat.material_id}, serial: ${mat.serial_number}`
  );

  // Create serial movement record
  await createSerialMovementRecord(
    movementId,
    mat.serial_number,
    mat.batch_id,
    mat.material_actual_qty,
    matItem.based_uom,
    plantId,
    organizationId
  );

  // Update serial balance (deduct consumption from reserved)
  await updateSerialBalance(
    mat.material_id,
    mat.serial_number,
    mat.batch_id,
    mat.bin_location_id,
    "Reserved",
    -mat.material_actual_qty,
    plantId,
    organizationId
  );

  // Note: unused quantity inventory movements handled in ICTP function

  // Update on_reserved_gd table (same as non-serialized items)
  const resOnReserve = await db
    .collection("on_reserved_gd")
    .where({
      parent_no: productionOrderNo,
      organization_id: organizationId,
      is_deleted: 0,
      material_id: mat.material_id,
      ...(matItem.item_batch_management === 1
        ? { batch_id: mat.batch_id }
        : {}),
      bin_location: mat.bin_location_id,
    })
    .get();

  if (!resOnReserve || resOnReserve.data.length === 0) {
    throw new Error(
      `Error fetching on reserve table for serialized item ${mat.material_id}, serial: ${mat.serial_number}`
    );
  }

  const onReserveData = resOnReserve.data[0];

  await db.collection("on_reserved_gd").doc(onReserveData.id).update({
    delivered_qty: mat.material_required_qty,
    open_qty: 0,
    doc_no: stockMovementGINo,
  });

  console.log(
    `Successfully processed serialized item Good Issue for ${mat.serial_number}`
  );
};

const processSerializedItemForProductionReceipt = async (
  data,
  plantId,
  organizationId,
  movementId,
  stockMovementNo,
  producedBatchId
) => {
  console.log(
    `Processing serialized item for Production Receipt: ${data.material_id}`
  );

  if (!data.serial_number_data) {
    console.log(
      `No serial number data found for Production Receipt item ${data.material_id}`
    );
    return;
  }

  let serialNumberData;
  try {
    serialNumberData = JSON.parse(data.serial_number_data);
  } catch (parseError) {
    console.error(
      `Error parsing serial number data for Production Receipt item ${data.material_id}:`,
      parseError
    );
    return;
  }

  const tableSerialNumber = serialNumberData.table_serial_number || [];
  const serialQuantity = serialNumberData.serial_number_qty || 0;
  const isAuto = serialNumberData.is_auto;

  // Validate manual serial numbers when is_auto = 0
  if (isAuto === 0) {
    const emptySerials = tableSerialNumber.filter(
      (serial) =>
        !serial.system_serial_number ||
        serial.system_serial_number.trim() === ""
    );

    if (emptySerials.length > 0) {
      throw new Error(
        `Manual serial number entry required: ${emptySerials.length} serial number(s) are empty. Please provide all serial numbers before completing the production order.`
      );
    }
  }

  // Validate mixed manual/auto serial numbers (some auto, some manual)
  const manualSerials = tableSerialNumber.filter(
    (serial) =>
      serial.system_serial_number &&
      serial.system_serial_number.trim() !== "" &&
      serial.system_serial_number !== "Auto generated serial number"
  );

  const emptyManualSerials = tableSerialNumber.filter(
    (serial) =>
      !serial.system_serial_number ||
      (serial.system_serial_number.trim() === "" &&
        serial.system_serial_number !== "Auto generated serial number")
  );

  if (emptyManualSerials.length > 0) {
    throw new Error(
      `Serial number validation failed: ${emptyManualSerials.length} serial number(s) are empty. Please provide all required serial numbers.`
    );
  }

  // Check for duplicate serial numbers
  const allSerialNumbers = manualSerials.map((s) =>
    s.system_serial_number.trim()
  );
  const duplicates = allSerialNumbers.filter(
    (serial, index) => allSerialNumbers.indexOf(serial) !== index
  );

  if (duplicates.length > 0) {
    throw new Error(
      `Duplicate serial numbers detected: ${[...new Set(duplicates)].join(
        ", "
      )}. Each serial number must be unique.`
    );
  }

  // Get item data for UOM
  const itemRes = await db
    .collection("Item")
    .where({ id: data.material_id })
    .get();
  if (!itemRes.data || !itemRes.data.length) {
    console.error(`Item not found: ${data.material_id}`);
    return;
  }
  const itemData = itemRes.data[0];

  let baseQty = roundQty(parseFloat(data.yield_qty || 0));
  let baseUOM = itemData.based_uom;

  // Calculate base quantity per serial number
  const baseQtyPerSerial = serialQuantity > 0 ? baseQty / serialQuantity : 0;

  // Process serial number generation if needed
  const updatedTableSerialNumber = [];
  let generatedCount = 0;
  let currentRunningNumber = null;
  let serialPrefix = "";

  if (isAuto === 1) {
    const needsGeneration = tableSerialNumber.some(
      (serial) => serial.system_serial_number === "Auto generated serial number"
    );

    if (needsGeneration) {
      const resSerialConfig = await db
        .collection("serial_level_config")
        .where({ organization_id: organizationId })
        .get();

      if (
        !resSerialConfig ||
        !resSerialConfig.data ||
        resSerialConfig.data.length === 0
      ) {
        throw new Error(
          `Serial number configuration not found for organization ${organizationId}`
        );
      }

      const serialConfigData = resSerialConfig.data[0];
      currentRunningNumber = serialConfigData.serial_running_number;
      serialPrefix = serialConfigData.serial_prefix
        ? `${serialConfigData.serial_prefix}-`
        : "";
    }
  }

  // Process all serial numbers sequentially
  for (
    let serialIndex = 0;
    serialIndex < tableSerialNumber.length;
    serialIndex++
  ) {
    const serialItem = tableSerialNumber[serialIndex];
    let finalSystemSerialNumber = serialItem.system_serial_number;

    // Generate new serial number if needed
    if (finalSystemSerialNumber === "Auto generated serial number") {
      finalSystemSerialNumber =
        serialPrefix +
        String(currentRunningNumber + generatedCount).padStart(10, "0");
      generatedCount++;
    }

    updatedTableSerialNumber.push({
      ...serialItem,
      system_serial_number: finalSystemSerialNumber,
    });

    if (
      finalSystemSerialNumber &&
      finalSystemSerialNumber !== "" &&
      finalSystemSerialNumber !== "Auto generated serial number"
    ) {
      // 1. Insert serial_number record
      const serialNumberRecord = {
        system_serial_number: finalSystemSerialNumber,
        supplier_serial_number: serialItem.supplier_serial_number || "",
        material_id: data.material_id,
        batch_id: producedBatchId,
        bin_location: data.target_bin_location,
        plant_id: plantId,
        organization_id: organizationId,
        transaction_no: stockMovementNo,
        parent_trx_no: "",
        create_time: new Date().toISOString(),
        update_time: new Date().toISOString(),
      };

      await db.collection("serial_number").add(serialNumberRecord);

      // 2. Insert inv_serial_movement record
      await createSerialMovementRecord(
        movementId,
        finalSystemSerialNumber,
        producedBatchId,
        baseQtyPerSerial,
        baseUOM,
        plantId,
        organizationId
      );

      // 3. Create serial balance record
      await createOrUpdateReceivingSerialBalance(
        data.material_id,
        finalSystemSerialNumber,
        producedBatchId,
        data.target_bin_location,
        data.category || "Unrestricted",
        baseQtyPerSerial,
        plantId,
        organizationId,
        baseUOM
      );
    }
  }

  // Update serial configuration if we generated new numbers
  if (generatedCount > 0 && currentRunningNumber !== null) {
    await db
      .collection("serial_level_config")
      .where({ organization_id: organizationId })
      .update({
        serial_running_number: currentRunningNumber + generatedCount,
      });
  }

  console.log(
    `Successfully processed serialized item Production Receipt for ${data.material_id}`
  );
};

const handleInventoryBalanceAndMovement = async (
  data,
  productionOrderNo,
  stockMovementNo,
  stockMovementGINo
) => {
  try {
    let totalInputCost = 0;

    // Group serialized and non-serialized items for inventory movement processing
    const serializedItems = [];
    const nonSerializedItems = [];

    // Separate items by type
    for (const mat of data.table_mat_confirmation) {
      const matItemQuery = await db
        .collection("Item")
        .where({ id: mat.material_id, is_deleted: 0 })
        .get();
      if (!matItemQuery.data || matItemQuery.data.length === 0) {
        throw new Error("Item not found for material_id: " + mat.material_id);
      }

      const matItem = matItemQuery.data[0];
      const isSerializedItem = matItem.serial_number_management === 1;

      if (isSerializedItem && mat.serial_number) {
        // Process all serialized items (including zero qty to handle reserved->unrestricted transfer)
        serializedItems.push({ mat, matItem });
      } else {
        // Process all non-serialized items (including zero qty to handle reserved->unrestricted transfer)
        nonSerializedItems.push({ mat, matItem });
      }
    }

    // Process serialized items - group by material_id, batch_id, and bin_location_id for inventory movement
    const serializedGroups = new Map();

    for (const { mat, matItem } of serializedItems) {
      // Skip items with 0 actual quantity for inventory movement grouping
      if (mat.material_actual_qty <= 0) continue;

      const groupKey = `${mat.material_id}_${mat.batch_id || "null"}_${
        mat.bin_location_id || "null"
      }`;

      if (!serializedGroups.has(groupKey)) {
        serializedGroups.set(groupKey, {
          material_id: mat.material_id,
          matItem: matItem,
          items: [],
          totalQty: 0,
          totalCost: 0,
          bin_location_id: mat.bin_location_id,
          batch_id: mat.batch_id,
        });
      }

      const group = serializedGroups.get(groupKey);
      group.items.push(mat);
      group.totalQty += mat.material_actual_qty;
    }

    // Process each serialized group
    for (const group of serializedGroups.values()) {
      console.log(
        `Processing serialized item group for Good Issue: ${group.material_id}, items: ${group.items.length}`
      );

      let groupTotalCost = 0;

      // Calculate costing for the group (skip individual inventory movements)
      for (const mat of group.items) {
        const { totalPrice } = await calculateCostingAndUpdateTables(
          mat,
          group.matItem,
          null, // No balance data needed for serialized items
          data.plant_id,
          db,
          "SM",
          stockMovementGINo,
          productionOrderNo,
          true // Skip inventory movement creation for serialized items
        );
        groupTotalCost += totalPrice;
      }

      totalInputCost += groupTotalCost;

      // Create single inventory movement record for this group
      const giMovement = {
        transaction_type: "SM",
        trx_no: stockMovementGINo,
        parent_trx_no: productionOrderNo,
        movement: "OUT",
        unit_price: group.totalQty > 0 ? groupTotalCost / group.totalQty : 0,
        total_price: groupTotalCost,
        quantity: group.totalQty,
        item_id: group.material_id,
        inventory_category: "Reserved",
        uom_id: group.matItem.based_uom,
        base_qty: group.totalQty,
        base_uom_id: group.matItem.based_uom,
        bin_location_id: group.bin_location_id,
        batch_number_id:
          group.matItem.item_batch_management === 1
            ? group.batch_id || null
            : null,
        costing_method_id: group.matItem.material_costing_method,
        created_at: new Date().toISOString(),
        plant_id: data.plant_id,
        organization_id: organizationId,
        update_time: new Date().toISOString(),
        is_deleted: 0,
      };

      await db.collection("inventory_movement").add(giMovement);
      console.log(
        `Created GI inventory movement for serialized item group ${group.material_id}`
      );

      // Small delay to ensure DB commit
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Fetch the inventory movement to get the actual ID
      const giMovementQuery = await db
        .collection("inventory_movement")
        .where({
          transaction_type: "SM",
          trx_no: stockMovementGINo,
          parent_trx_no: productionOrderNo,
          movement: "OUT",
          item_id: group.material_id,
          inventory_category: "Reserved",
          bin_location_id: group.bin_location_id,
        })
        .get();

      if (giMovementQuery.data && giMovementQuery.data.length > 0) {
        const giMovementId = giMovementQuery.data[0].id;
        console.log(`Retrieved GI inventory movement ID: ${giMovementId}`);

        // Process individual serial numbers in this group (filter out 0 quantities)
        for (const mat of group.items.filter(
          (item) => item.material_actual_qty > 0
        )) {
          await processSerializedItemForGoodIssue(
            mat,
            group.matItem,
            data.plant_id,
            organizationId,
            giMovementId,
            productionOrderNo,
            stockMovementGINo
          );
        }
      }
    }

    // Process non-serialized items (existing logic)
    for (const { mat, matItem } of nonSerializedItems) {
      console.log(
        "Processing consumed material_id:",
        mat.material_id,
        "Quantity:",
        mat.material_actual_qty
      );

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

          const { totalPrice } = await calculateCostingAndUpdateTables(
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
                (matBalance.reserved_qty || 0) - mat.material_actual_qty
              ).toFixed(3)
            ),
            // Note: unused quantity return handled in ICTP function
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

            const { totalPrice } = await calculateCostingAndUpdateTables(
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

        const { totalPrice } = await calculateCostingAndUpdateTables(
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
    const isSerializedItem = item.serial_number_management === 1;
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

    await db.collection("inventory_movement").add(inMovement);
    console.log(`Inventory movement record created for produced item`);

    // Handle serialized items for Production Receipt
    if (isSerializedItem && data.serial_number_data) {
      console.log(
        `Processing serialized item Production Receipt for ${data.material_id}`
      );

      // Small delay to ensure DB commit
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Fetch the inventory movement to get the actual ID
      const movementQuery = await db
        .collection("inventory_movement")
        .where({
          transaction_type: "SM",
          trx_no: stockMovementNo,
          parent_trx_no: productionOrderNo,
          movement: "IN",
          item_id: data.material_id,
          inventory_category: data.category,
          bin_location_id: data.target_bin_location,
        })
        .get();

      if (movementQuery.data && movementQuery.data.length > 0) {
        const movementId = movementQuery.data[0].id;
        console.log(
          `Retrieved Production Receipt inventory movement ID: ${movementId}`
        );

        await processSerializedItemForProductionReceipt(
          data,
          data.plant_id,
          organizationId,
          movementId,
          stockMovementNo,
          producedBatchId
        );
      }
    }

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
      } catch {
        throw new Error(
          `Cannot update last transaction date for item #${index + 1}.`
        );
      }
    }
  } catch (error) {
    throw new Error(error);
  }
};

const createICTPStockMovement = async (allData) => {
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
      const unusedQty = mat.material_required_qty - mat.material_actual_qty;

      if (materialData.serial_number_management === 1) {
        // For serialized items, create inventory movements and handle serial balance updates
        const baseQTY = await convertUOM(materialData, mat);

        const inventoryMovementOUTData = {
          transaction_type: "SM",
          trx_no: prefix,
          parent_trx_no: allData.production_order_no,
          movement: "OUT",
          unit_price: 0,
          total_price: 0,
          quantity: unusedQty,
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
          parent_trx_no: allData.production_order_no,
          movement: "IN",
          unit_price: 0,
          total_price: 0,
          quantity: unusedQty,
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

        // Handle serialized item unused quantity return
        if (mat.serial_number && unusedQty > 0) {
          // Small delay to ensure DB commit
          await new Promise((resolve) => setTimeout(resolve, 100));

          // Fetch the IN movement to get the actual ID
          const inMovementQuery = await db
            .collection("inventory_movement")
            .where({
              transaction_type: "SM",
              trx_no: prefix,
              parent_trx_no: allData.production_order_no,
              movement: "IN",
              item_id: mat.material_id,
              inventory_category: "Unrestricted",
              bin_location_id: mat.bin_location_id,
            })
            .get();

          if (inMovementQuery.data && inMovementQuery.data.length > 0) {
            const inMovementId = inMovementQuery.data[0].id;

            // Create inv_serial_movement for unused quantity return
            await createSerialMovementRecord(
              inMovementId,
              mat.serial_number,
              mat.batch_id,
              unusedQty,
              materialData.based_uom,
              allData.plant_id,
              allData.organization_id
            );
          }

          // Update serial balance: Reserved -> Unrestricted
          await updateSerialBalance(
            mat.material_id,
            mat.serial_number,
            mat.batch_id,
            mat.bin_location_id,
            "Reserved",
            -unusedQty,
            allData.plant_id,
            allData.organization_id
          );

          await updateSerialBalance(
            mat.material_id,
            mat.serial_number,
            mat.batch_id,
            mat.bin_location_id,
            "Unrestricted",
            unusedQty,
            allData.plant_id,
            allData.organization_id
          );

          console.log(
            `ICTP: Processed unused quantity return for serial ${mat.serial_number}: ${unusedQty}`
          );
        }
      } else {
        // Non-serialized items
        const baseQTY = await convertUOM(materialData, mat);

        const inventoryMovementOUTData = {
          transaction_type: "SM",
          trx_no: prefix,
          parent_trx_no: allData.production_order_no,
          movement: "OUT",
          unit_price: 0,
          total_price: 0,
          quantity: unusedQty,
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
          parent_trx_no: allData.production_order_no,
          movement: "IN",
          unit_price: 0,
          total_price: 0,
          quantity: unusedQty,
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
      }

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

  await createICTPStockMovement(allData);

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
