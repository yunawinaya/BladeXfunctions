class StockAdjuster {
  constructor(db) {
    this.db = db;
    this.categoryMap = {
      Unrestricted: "unrestricted_qty",
      "Quality Inspection": "qualityinsp_qty",
      Blocked: "block_qty",
      Reserved: "reserved_qty",
    };
  }

  validateRequiredFields(data, requiredFields, context = "") {
    const missingFields = requiredFields.filter(
      (field) => !data[field] && data[field] !== 0
    );
    if (missingFields.length > 0) {
      throw new Error(
        `Please fill in all required fields marked with (*) ${context}: ${missingFields.join(
          ", "
        )}`
      );
    }
  }

  async updateProductionOrder(allData, subformData) {
    if (allData.is_production_order !== 1 || !allData.production_order_id) {
      return; // Skip if not a production order or no production order ID
    }

    const tableMatConfirmation = subformData.map((item) => ({
      material_id: item.item_selection,
      material_required_qty: item.total_quantity || item.received_quantity || 0,
      bin_location_id: item.location_id,
    }));

    try {
      const productionOrderResponse = await this.db
        .collection("production_order")
        .where({ id: allData.production_order_id })
        .get();

      if (
        !productionOrderResponse.data ||
        productionOrderResponse.data.length === 0
      ) {
        throw new Error(
          `Production order ${allData.production_order_id} not found`
        );
      }

      const productionOrderId = productionOrderResponse.data[0].id;
      await this.db
        .collection("production_order")
        .doc(productionOrderId)
        .update({
          table_mat_confirmation: tableMatConfirmation,
          production_order_status: "In Progress",
          update_time: new Date().toISOString(),
        });

      console.log(
        `Production order ${allData.production_order_id} updated successfully`
      );
    } catch (error) {
      console.error("Error updating production order:", error);
      throw new Error(`Failed to update production order: ${error.message}`);
    }
  }

  async preValidateItems(subformData, movementType, allData) {
    for (const item of subformData) {
      this.validateRequiredFields(
        item,
        ["item_selection"],
        `for item ${item.item_selection || "unknown"}`
      );

      const materialResponse = await this.db
        .collection("Item")
        .where({ id: item.item_selection })
        .get();
      const materialData = materialResponse.data[0];
      // UOM comparison and conversion logic
      let quantityConverted = item.received_quantity || 0;
      let selected_uom = materialData.based_uom; // Default to base UOM

      if (
        movementType === "Miscellaneous Receipt" &&
        item.received_quantity_uom
      ) {
        if (item.received_quantity_uom === materialData.based_uom) {
          selected_uom = materialData.based_uom;
        } else {
          const uomConversion = materialData.table_uom_conversion?.find(
            (conversion) => conversion.alt_uom_id === item.received_quantity_uom
          );
          if (uomConversion) {
            selected_uom = uomConversion.alt_uom_id;
            quantityConverted =
              Math.round(
                (item.received_quantity || 0) * uomConversion.base_qty * 1000
              ) / 1000;
          } else {
            throw new Error(
              `Invalid UOM ${item.received_quantity_uom} for item ${item.item_selection}`
            );
          }
        }
      }

      // Always set effective_uom and quantity_converted for the item
      item.effective_uom = selected_uom;
      item.quantity_converted = quantityConverted;

      console.log(
        `preValidateItems: item ${item.item_selection}, effective_uom: ${item.effective_uom}, quantity_converted: ${quantityConverted}`
      );

      if (
        movementType === "Inter Operation Facility Transfer" ||
        movementType === "Miscellaneous Receipt"
      ) {
        if (!item.received_quantity || item.received_quantity <= 0) {
          continue;
        }
      } else {
        if (!allData.balance_index || !Array.isArray(allData.balance_index)) {
          throw new Error(
            `Balance selection (balance_index) is required for item ${item.item_selection}`
          );
        }

        const balancesToProcess = allData.balance_index.filter(
          (balance) => balance.sm_quantity && balance.sm_quantity > 0
        );

        if (balancesToProcess.length === 0) {
          continue;
        }

        if (movementType === "Location Transfer") {
          balancesToProcess.forEach((balance) => {
            if (!balance.location_id && !item.location_id) {
              throw new Error(
                `Receiving bin ID (receiving_bin_id) is required for Location Transfer for item ${item.item_selection}`
              );
            }
          });
        }

        const collectionName =
          materialData.item_batch_management == "1"
            ? "item_batch_balance"
            : "item_balance";
        for (const balance of balancesToProcess) {
          this.validateRequiredFields(
            balance,
            ["sm_quantity", "location_id"],
            `for balance in item ${item.item_selection}`
          );

          const balanceResponse = await this.db
            .collection(collectionName)
            .where({
              material_id: materialData.id,
              location_id: balance.location_id,
            })
            .get();
          const balanceData = balanceResponse.data[0];

          const categoryField =
            this.categoryMap[balance.category || subformData.category];
          // if (!categoryField && movementType != 'Inventory Category Transfer Posting') {
          //     throw new Error(`Invalid category: ${balance.category || 'Unrestricted'}`);
          // }

          if (!balanceData) {
            throw new Error(
              `No existing balance found for item ${item.item_selection} at location ${balance.location_id}`
            );
          }

          const currentQty = balanceData[categoryField] || 0;
          const requestedQty =
            balance.quantity_converted > 0
              ? balance.quantity_converted
              : balance.sm_quantity;

          // if (movementType === 'Miscellaneous Issue' ||
          //     movementType === 'Disposal/Scrap' ||
          //     movementType === 'Location Transfer') {
          //     if (currentQty < requestedQty) {
          //         throw new Error(`Insufficient quantity in ${balance.category || subformData.category} for item ${item.item_selection} at location ${balance.location_id}. Available: ${currentQty}, Requested: ${requestedQty}`);
          //     }
          // } else if (movementType === 'Inventory Category Transfer Posting') {
          //     if (!balance.category_from || !balance.category_to) {
          //         throw new Error(`Both category_from and category_to are required for Inventory Category Transfer Posting for item ${item.item_selection}`);
          //     }
          //     const fromCategoryField = this.categoryMap[balance.category_from];
          //     const currentFromQty = balanceData[fromCategoryField] || 0;
          //     if (currentFromQty < requestedQty) {
          //         throw new Error(`Insufficient quantity in ${balance.category_from} for item ${item.item_selection} at location ${balance.location_id}. Available: ${currentFromQty}, Requested: ${requestedQty}`);
          //     }
          // }
        }
      }
    }
  }

  async processStockAdjustment(allData) {
    console.log("This is all data", allData);
    const subformData = allData.stock_movement;
    const movementTypeId = allData.movement_type;

    const requiredTopLevelFields = [
      "stock_movement_no",
      "movement_type",
      "issue_date",
    ];
    this.validateRequiredFields(allData, requiredTopLevelFields);

    const response = await this.db
      .collection("stock_movement_type")
      .where({ id: movementTypeId })
      .get();
    const movementType = response.data[0].sm_type_name;

    await this.preValidateItems(subformData, movementType, allData);
    await this.updateStockMovementTable(allData, subformData, movementTypeId);

    // Update production order for Location Transfer if applicable
    if (
      movementType === "Location Transfer" &&
      allData.is_production_order === 1
    ) {
      await this.updateProductionOrder(allData, subformData);
    }

    const updates = await Promise.all(
      subformData.map((item) => this.processItem(item, movementType, allData))
    );

    return updates;
  }

  async updateStockMovementTable(allData, subformData, movementTypeId) {
    const table_item_balance = allData.sm_item_balance?.table_item_balance;
    const stockMovementData = {
      stock_movement_no: allData.stock_movement_no,
      movement_type: allData.movement_type,
      movement_reason: allData.movement_reason || null,
      issued_by: allData.issued_by || allData.user_id || "system",
      issue_date: allData.issue_date,
      tenant_id: allData.tenant_id || "000000",
      issuing_operation_faci: allData.issuing_operation_faci,
      stock_movement: subformData,
      sm_item_balance: allData.sm_item_balance,
      table_item_balance: table_item_balance,
      remarks: allData.remarks,
      delivery_method: allData.delivery_method,
      driver_name: allData.driver_name,
      vehicle_no: allData.vehicle_no,
      pickup_date: allData.pickup_date,
      courier_company: allData.courier_company,
      tracking_number: allData.tracking_number,
      est_arrival_date: allData.est_arrival_date,
      freight_charges: allData.freight_charges,
      driver_contact_no: allData.driver_contact_no,
      delivery_cost: allData.delivery_cost,
      est_delivery_date: allData.est_delivery_date,
      shipping_company: allData.shipping_company,
      shipping_method: allData.shipping_method,
      date_qn0dl3t6: allData.date_qn0dl3t6,
      input_77h4nsq8: allData.input_77h4nsq8,
      tracking_no: allData.tracking_no,
      balance_index: allData.balance_index,
    };

    const page_status = this.getParamsVariables
      ? this.getParamsVariables("page_status")
      : null;
    const stockMovementNo = this.getParamsVariables("stock_movement_no");

    if (page_status === "Add") {
      const result = await this.db.collection("stock_movement").add({
        stock_movement_status: "Completed",
        ...stockMovementData,
      });
      console.log("Stock Movement Added:", result);

      await this.db
        .collection("prefix_configuration")
        .where({ document_types: "Stock Movement", is_deleted: 0 })
        .get()
        .then((prefixEntry) => {
          if (prefixEntry.data.length > 0) {
            const data = prefixEntry.data[0];
            return this.db
              .collection("prefix_configuration")
              .where({ document_types: "Stock Movement", is_deleted: 0 })
              .update({
                running_number: parseInt(data.running_number) + 1,
              });
          }
        });
    } else if (page_status === "Edit") {
      if (!stockMovementNo) {
        throw new Error("Stock movement number is required for editing");
      }
      const existingRecord = await this.db
        .collection("stock_movement")
        .where({ id: stockMovementNo })
        .get();

      if (existingRecord.data.length === 0) {
        throw new Error(
          `Stock movement ${stockMovementNo} not found for editing`
        );
      }

      const recordId = existingRecord.data[0].id;
      const result = await this.db
        .collection("stock_movement")
        .doc(recordId)
        .update({
          stock_movement_status: "Completed",
          ...stockMovementData,
          update_time: new Date().toISOString(),
        });
      console.log("Stock Movement Updated:", result);
    }
  }

  async processItem(item, movementType, allData) {
    const materialResponse = await this.db
      .collection("Item")
      .where({ id: item.item_selection })
      .get();
    const materialData = materialResponse.data[0];

    const balancesToProcess =
      allData.balance_index?.filter(
        (balance) => balance.sm_quantity && balance.sm_quantity > 0
      ) || [];

    if (
      movementType === "Miscellaneous Receipt" &&
      (!item.received_quantity || item.received_quantity <= 0)
    ) {
      return {
        itemId: item.item_selection,
        status: "skipped",
        reason: "No received quantity provided",
      };
    }

    const updates = await Promise.all(
      balancesToProcess.map((balance) =>
        Promise.all([
          this.updateQuantities(
            materialData,
            movementType,
            balance,
            allData,
            item
          ),
          this.recordInventoryMovement(
            materialData,
            movementType,
            balance,
            allData,
            item
          ),
        ])
      )
    );

    if (
      movementType === "Miscellaneous Receipt" &&
      item.received_quantity > 0
    ) {
      await Promise.all([
        this.updateQuantities(materialData, movementType, {}, allData, item),
        this.recordInventoryMovement(
          materialData,
          movementType,
          { sm_quantity: item.received_quantity },
          allData,
          item
        ),
      ]);
    }

    return { itemId: item.item_selection, status: "success" };
  }

  async updateQuantities(
    materialData,
    movementType,
    balance,
    allData,
    subformData
  ) {
    const collectionName =
      materialData.item_batch_management == "1"
        ? "item_batch_balance"
        : "item_balance";
    let qtyChangeValue =
      movementType === "Miscellaneous Receipt"
        ? subformData.quantity_converted || subformData.received_quantity || 0
        : balance.quantity_converted || balance.sm_quantity || 0;
    const locationId = balance.location_id || subformData.location_id;
    const effectiveUom =
      balance.effective_uom ||
      subformData.effective_uom ||
      materialData.based_uom;

    console.log(
      `updateQuantities: item ${materialData.id}, movement ${movementType}, effectiveUom: ${effectiveUom}, qtyChangeValue: ${qtyChangeValue}`
    );

    if (qtyChangeValue === 0) return;

    if (!locationId && movementType !== "Miscellaneous Receipt") {
      throw new Error("Location ID is required");
    }

    if (!effectiveUom) {
      throw new Error(`Effective UOM is undefined for item ${materialData.id}`);
    }

    // Derive the category field without modifying balance.category
    const categoryKey =
      movementType === "Location Transfer" ||
      movementType === "Miscellaneous Receipt"
        ? subformData.category
        : balance.category;
    const categoryField = this.categoryMap[categoryKey];

    // if (!categoryField && movementType != 'Inventory Category Transfer Posting') {
    // throw new Error(`Invalid category: ${categoryKey}`);
    // }

    const balanceResponse = await this.db
      .collection(collectionName)
      .where({ material_id: materialData.id, location_id: locationId })
      .get();
    let balanceData = balanceResponse.data[0];

    let updateData = balanceData
      ? { ...balanceData }
      : {
          material_id: materialData.id,
          location_id: locationId,
          balance_quantity: 0,
          unrestricted_qty: 0,
          qualityinsp_qty: 0,
          block_qty: 0,
          reserved_qty: 0,
          batch_id:
            materialData.item_batch_management == "1" ? balance.batch_id : null,
          plant_id: allData.issuing_operation_faci,
          create_user: allData.user_id || "system",
          issue_date: allData.issue_date,
          update_user: allData.user_id || "system",
          is_deleted: 0,
          tenant_id: allData.tenant_id || "000000",
        };

    switch (movementType) {
      case "Inter Operation Facility Transfer":
        updateData.balance_quantity =
          (updateData.balance_quantity || 0) + qtyChangeValue;
        updateData[categoryField] =
          (updateData[categoryField] || 0) + qtyChangeValue;
        break;

      case "Location Transfer":
        updateData.balance_quantity =
          (updateData.balance_quantity || 0) - qtyChangeValue;
        updateData[categoryField] =
          (updateData[categoryField] || 0) - qtyChangeValue;
        break;

      case "Miscellaneous Issue":
      case "Disposal/Scrap":
        updateData.balance_quantity =
          (updateData.balance_quantity || 0) - qtyChangeValue;
        updateData[categoryField] =
          (updateData[categoryField] || 0) - qtyChangeValue;
        break;

      case "Miscellaneous Receipt":
        updateData.balance_quantity =
          (updateData.balance_quantity || 0) + qtyChangeValue;
        updateData[categoryField] =
          (updateData[categoryField] || 0) + qtyChangeValue;
        if (materialData.item_batch_management == "1") {
          const batchId = await this.createBatch(
            materialData,
            qtyChangeValue,
            allData,
            subformData
          );
          console.log("batchId", batchId);
          updateData.batch_id = batchId;
        }
        break;

      case "Inventory Category Transfer Posting":
        if (!balance.category_from || !balance.category_to) {
          throw new Error("Both category_from and category_to are required");
        }
        const fromCategoryField = this.categoryMap[balance.category_from];
        const toCategoryField = this.categoryMap[balance.category_to];
        updateData[fromCategoryField] =
          (updateData[fromCategoryField] || 0) - qtyChangeValue;
        updateData[toCategoryField] =
          (updateData[toCategoryField] || 0) + qtyChangeValue;
        break;

      default:
        throw new Error(`Unsupported movement type: ${movementType}`);
    }

    updateData.update_time = new Date().toISOString();
    updateData.update_user = allData.user_id || "system";

    if (!balanceData) {
      await this.db.collection(collectionName).add(updateData);
    } else {
      const updateFields = {
        balance_quantity: updateData.balance_quantity,
        unrestricted_qty: updateData.unrestricted_qty,
        qualityinsp_qty: updateData.qualityinsp_qty,
        block_qty: updateData.block_qty,
        reserved_qty: updateData.reserved_qty,
        update_time: updateData.update_time,
        update_user: updateData.update_user,
        plant_id: updateData.plant_id,
      };
      if (materialData.item_batch_management == "1") {
        updateFields.batch_id = updateData.batch_id;
      }
      await this.db
        .collection(collectionName)
        .doc(balanceData.id)
        .update(updateFields);
    }

    if (
      [
        "Miscellaneous Issue",
        "Disposal/Scrap",
        "Miscellaneous Receipt",
      ].includes(movementType)
    ) {
      const qtyChange =
        movementType === "Miscellaneous Receipt"
          ? qtyChangeValue
          : -qtyChangeValue;
      await this.updateCostingMethod(
        materialData,
        qtyChange,
        allData.issuing_operation_faci,
        subformData,
        updateData
      );
    }

    if (movementType === "Location Transfer") {
      await this.updateReceivingLocation(
        materialData,
        collectionName,
        subformData.location_id,
        qtyChangeValue,
        balance,
        allData,
        subformData,
        movementType
      );
    }
  }

  async updateReceivingLocation(
    materialData,
    collectionName,
    receivingLocationId,
    qtyChangeValue,
    balance,
    allData,
    subformData,
    movementType
  ) {
    if (!receivingLocationId) {
      throw new Error(
        "Receiving location ID is required for Location Transfer"
      );
    }

    const effectiveUom =
      balance.effective_uom ||
      subformData.effective_uom ||
      materialData.based_uom;
    qtyChangeValue = balance.quantity_converted || qtyChangeValue;

    console.log(
      `updateReceivingLocation: item ${materialData.id}, effectiveUom: ${effectiveUom}, qtyChangeValue: ${qtyChangeValue}`
    );

    if (!effectiveUom) {
      throw new Error(
        `Effective UOM is undefined for item ${materialData.id} in receiving location`
      );
    }

    const balanceResponse = await this.db
      .collection(collectionName)
      .where({ material_id: materialData.id, location_id: receivingLocationId })
      .get();
    let balanceData = balanceResponse.data[0];

    let updateData = balanceData
      ? { ...balanceData }
      : {
          material_id: materialData.id,
          location_id: receivingLocationId,
          balance_quantity: 0,
          unrestricted_qty: 0,
          qualityinsp_qty: 0,
          block_qty: 0,
          reserved_qty: 0,
          batch_id:
            materialData.item_batch_management == "1" ? balance.batch_id : null,
          plant_id: allData.issuing_operation_faci,
          create_user: allData.user_id || "system",
          issue_date: allData.issue_date,
          update_user: allData.user_id || "system",
          is_deleted: 0,
          tenant_id: allData.tenant_id || "000000",
          organization_id: materialData.organization_id || "default_org",
        };

    const categoryField =
      movementType === "Location Transfer" ||
      movementType === "Miscellaneous Receipt"
        ? this.categoryMap[subformData.category]
        : this.categoryMap[balance.category];
    updateData.balance_quantity =
      (updateData.balance_quantity || 0) + qtyChangeValue;
    updateData[categoryField] =
      (updateData[categoryField] || 0) + qtyChangeValue;

    updateData.update_time = new Date().toISOString();
    updateData.update_user = allData.user_id || "system";

    if (!balanceData) {
      await this.db.collection(collectionName).add(updateData);
    } else {
      const updateFields = {
        balance_quantity: updateData.balance_quantity,
        unrestricted_qty: updateData.unrestricted_qty,
        qualityinsp_qty: updateData.qualityinsp_qty,
        block_qty: updateData.block_qty,
        reserved_qty: updateData.reserved_qty,
        update_time: updateData.update_time,
        update_user: updateData.update_user,
        plant_id: updateData.plant_id,
      };
      if (materialData.item_batch_management == "1") {
        updateFields.batch_id = updateData.batch_id;
      }
      await this.db
        .collection(collectionName)
        .doc(balanceData.id)
        .update(updateFields);
    }
  }

  async updatePendingReceive(materialId, receivedQty, allData) {
    const pendingRecQuery = await this.db
      .collection("stock_movement")
      .where({ stock_movement_no: allData.stock_movement_no })
      .get();
  }

  async createBatch(materialData, quantity, allData, subformData) {
    const batchNumber = `BATCH-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 5)}`;
    const batchData = {
      batch_number: subformData.batch_id || batchNumber,
      material_id: materialData.id,
      initial_quantity: quantity,
      plant_id: allData.issuing_operation_faci,
      transaction_no: allData.stock_movement_no,
      organization_id: materialData.organization_id || "default_org",
      created_at: new Date(),
      create_user: allData.user_id || "system",
    };

    try {
      await this.db.collection("batch").add(batchData);

      await new Promise((resolve) => setTimeout(resolve, 300));

      const batchQuery = await this.db
        .collection("batch")
        .where({
          batch_number: subformData.batch_id || batchNumber,
          material_id: materialData.id,
        })
        .get();

      if (!batchQuery.data || !batchQuery.data.length) {
        throw new Error("Batch was created but could not be retrieved");
      }

      return batchQuery.data[0].id;
    } catch (error) {
      console.error("Error creating or retrieving batch:", error);
      throw new Error(`Failed to create batch: ${error.message}`);
    }
  }

  async updateCostingMethod(
    materialData,
    quantityChange,
    plantId,
    subformData,
    balanceData
  ) {
    try {
      console.log("updateCostingMethod inputs:", {
        materialData,
        quantityChange,
        plantId,
        subformData,
        balanceData,
      });

      if (!materialData?.id) {
        throw new Error("Invalid material data: material_id is missing");
      }

      if (!materialData.material_costing_method) {
        throw new Error("Material costing method is not defined");
      }

      if (!plantId) {
        throw new Error("Plant ID is required for costing update");
      }

      const organizationId = materialData.organization_id || "default_org";
      const costingMethod = materialData.material_costing_method;
      const qtyChangeValue =
        subformData.quantity_converted || quantityChange || 0;

      if (qtyChangeValue === 0) {
        console.log("No quantity change, skipping costing update");
        return;
      }

      if (!["Weighted Average", "First In First Out"].includes(costingMethod)) {
        throw new Error(`Unsupported costing method: ${costingMethod}`);
      }

      // Determine unit price: balance > subformData > materialData
      const unitPrice =
        balanceData.unit_price && balanceData.unit_price !== 0
          ? balanceData.unit_price
          : subformData.unit_price && subformData.unit_price !== 0
          ? subformData.unit_price
          : materialData.purchase_unit_price || 0;

      if (unitPrice === 0) {
        console.warn("Unit price is zero, proceeding with costing update");
      }

      if (costingMethod === "Weighted Average") {
        const waQuery =
          materialData.item_batch_management == "1" && balanceData.batch_id
            ? this.db.collection("wa_costing_method").where({
                material_id: materialData.id,
                batch_id: balanceData.batch_id,
                plant_id: plantId,
              })
            : this.db
                .collection("wa_costing_method")
                .where({ material_id: materialData.id, plant_id: plantId });

        const waResponse = await waQuery.get();
        if (!waResponse || !waResponse.data) {
          throw new Error("Failed to retrieve weighted average costing data");
        }

        const waData = waResponse.data;

        let newWaQuantity, newWaCostPrice;

        if (waData.length === 0 && qtyChangeValue > 0) {
          // Create new WA record for first receipt
          newWaQuantity = qtyChangeValue;
          newWaCostPrice = unitPrice;

          await this.db.collection("wa_costing_method").add({
            material_id: materialData.id,
            batch_id: balanceData.batch_id || null,
            plant_id: plantId,
            organization_id: organizationId,
            wa_quantity: newWaQuantity,
            wa_cost_price: newWaCostPrice,
            created_at: new Date().toISOString(),
          });
        } else if (waData.length > 0) {
          // Debug logging
          console.log("WA Data found:", {
            count: waData.length,
            firstItem: waData[0],
            dataTypes: waData.map((item) => typeof item),
            hasCreatedAt: waData.map((item) => Boolean(item.created_at)),
            hasId: waData.map((item) => Boolean(item.id)),
          });

          // Safely sort and get the latest record
          let latestWa;
          try {
            latestWa = waData.sort(
              (a, b) =>
                new Date(b.created_at || 0) - new Date(a.created_at || 0)
            )[0];

            // Verify latestWa is valid
            if (!latestWa) {
              throw new Error("No WA records found after sorting");
            }

            if (!latestWa.id) {
              throw new Error("Latest WA record has no ID");
            }

            console.log("Latest WA record:", {
              id: latestWa.id,
              wa_quantity: latestWa.wa_quantity,
              wa_cost_price: latestWa.wa_cost_price,
              created_at: latestWa.created_at,
            });
          } catch (sortError) {
            console.error("Error during WA record sorting:", sortError);
            throw new Error(
              `Error processing WA records: ${sortError.message}`
            );
          }

          // Continue with your existing code
          const currentQty = latestWa.wa_quantity || 0;
          const currentCostPrice = latestWa.wa_cost_price || 0;

          // Rest of your code...

          if (qtyChangeValue > 0) {
            // Receipt
            newWaQuantity = currentQty + qtyChangeValue;
            const currentTotalCost = currentCostPrice * currentQty;
            const newTotalCost = unitPrice * qtyChangeValue;
            newWaCostPrice =
              newWaQuantity > 0
                ? (currentTotalCost + newTotalCost) / newWaQuantity
                : 0;
          } else {
            // Delivery
            const deliveredQuantity = Math.abs(qtyChangeValue);
            newWaQuantity = currentQty - deliveredQuantity;

            if (newWaQuantity < 0) {
              throw new Error(
                `Insufficient WA quantity: available ${currentQty}, requested ${deliveredQuantity}`
              );
            }

            const currentTotalCost = currentCostPrice * currentQty;
            const deliveryTotalCost = currentCostPrice * deliveredQuantity;
            newWaCostPrice =
              newWaQuantity > 0
                ? (currentTotalCost - deliveryTotalCost) / newWaQuantity
                : 0;
          }

          await this.db
            .collection("wa_costing_method")
            .doc(latestWa.id)
            .update({
              wa_quantity: newWaQuantity,
              wa_cost_price: newWaCostPrice,
              updated_at: new Date().toISOString(),
            });
        } else {
          console.log("waQuery", waQuery);
          console.log("waResponse", waQuery);
          throw new Error(
            `No WA costing record found for deduction: material ${materialData.id}, plant ${plantId}`
          );
        }
      } else if (costingMethod === "First In First Out") {
        const fifoQuery =
          materialData.item_batch_management == "1" && balanceData.batch_id
            ? this.db.collection("fifo_costing_history").where({
                material_id: materialData.id,
                batch_id: balanceData.batch_id,
              })
            : this.db
                .collection("fifo_costing_history")
                .where({ material_id: materialData.id });

        const fifoResponse = await fifoQuery.get();
        if (!fifoResponse || !fifoResponse.data) {
          throw new Error("Failed to retrieve FIFO costing data");
        }

        const fifoData = Array.isArray(fifoResponse.data)
          ? fifoResponse.data
          : [];

        if (qtyChangeValue > 0) {
          // Receipt - Create a new FIFO layer
          const latestSequence =
            fifoData.length > 0
              ? Math.max(...fifoData.map((record) => record.fifo_sequence || 0))
              : 0;

          await this.db.collection("fifo_costing_history").add({
            material_id: materialData.id,
            batch_id: balanceData.batch_id || null,
            plant_id: plantId,
            organization_id: organizationId,
            fifo_initial_quantity: qtyChangeValue,
            fifo_available_quantity: qtyChangeValue,
            fifo_cost_price: unitPrice,
            fifo_sequence: latestSequence + 1,
            created_at: new Date().toISOString(),
          });
        } else if (qtyChangeValue < 0) {
          // Delivery - Reduce quantities from oldest FIFO layers first
          let remainingDeduction = Math.abs(qtyChangeValue);

          // Sort by sequence (oldest first per FIFO principle)
          const sortedFifoData = fifoData.sort(
            (a, b) => (a.fifo_sequence || 0) - (b.fifo_sequence || 0)
          );

          // Verify we have enough total quantity
          const totalAvailable = sortedFifoData.reduce(
            (sum, record) => sum + (record.fifo_available_quantity || 0),
            0
          );

          if (totalAvailable < remainingDeduction) {
            throw new Error(
              `Insufficient FIFO quantity: available ${totalAvailable}, requested ${remainingDeduction}`
            );
          }

          // Deduct from each layer starting with the oldest (lowest sequence)
          for (const record of sortedFifoData) {
            if (remainingDeduction <= 0) break;

            const available = record.fifo_available_quantity || 0;
            if (available <= 0) continue;

            const deduction = Math.min(available, remainingDeduction);
            const newAvailable = available - deduction;

            await this.db
              .collection("fifo_costing_history")
              .doc(record.id)
              .update({
                fifo_available_quantity: newAvailable,
                updated_at: new Date().toISOString(),
              });

            remainingDeduction -= deduction;
          }

          if (remainingDeduction > 0) {
            throw new Error(
              `Insufficient FIFO quantity: remaining ${remainingDeduction} after processing all layers`
            );
          }
        }
      }
    } catch (error) {
      console.error("Detailed error in updateCostingMethod:", {
        message: error.message || "Unknown error",
        stack: error.stack || "No stack trace",
        material_id: materialData.id,
        quantityChange,
        plantId,
        costing_method: materialData.material_costing_method,
        batch_id: balanceData.batch_id,
        subformData,
        balanceData,
      });
      throw new Error(
        `Failed to update costing method: ${error.message || "Unknown error"}`
      );
    }
  }

  async recordInventoryMovement(
    materialData,
    movementType,
    balance,
    allData,
    subformData
  ) {
    console.log("recordInventoryMovement inputs:", {
      materialData,
      movementType,
      balance,
      subformData,
    });

    const originalQty =
      balance.sm_quantity || subformData.received_quantity || 0;
    const convertedQty =
      balance.quantity_converted ||
      subformData.quantity_converted ||
      originalQty;
    const effectiveUom =
      balance.effective_uom ||
      subformData.effective_uom ||
      materialData.based_uom;

    console.log(
      `recordInventoryMovement: item ${materialData.id}, effectiveUom: ${effectiveUom}, originalQty: ${originalQty}, convertedQty: ${convertedQty}`
    );

    if (!effectiveUom) {
      throw new Error(
        `Effective UOM is undefined for item ${materialData.id} in inventory movement`
      );
    }

    const unitPrice =
      balance.unit_price && balance.unit_price !== 0
        ? balance.unit_price
        : subformData.unit_price && subformData.unit_price !== 0
        ? subformData.unit_price
        : materialData.purchase_unit_price || 0;

    const baseMovementData = {
      transaction_type: "SM",
      trx_no: allData.stock_movement_no,
      unit_price: unitPrice,
      total_price: unitPrice * convertedQty,
      quantity: originalQty,
      item_id: materialData.id,
      inventory_category: balance.category || subformData.category,
      uom_id: effectiveUom,
      base_qty: convertedQty,
      base_uom_id: materialData.based_uom,
      batch_number_id:
        materialData.item_batch_management == "1" ? balance.batch_id : null,
      costing_method_id: materialData.material_costing_method,
      plant_id: allData.issuing_operation_faci,
      created_at: new Date(),
      organization_id: materialData.organization_id || "default_org",
    };

    switch (movementType) {
      case "Location Transfer":
        const outMovement = {
          ...baseMovementData,
          movement: "OUT",
          bin_location_id: balance.location_id,
          inventory_category: balance.category,
        };
        const inMovement = {
          ...baseMovementData,
          movement: "IN",
          bin_location_id: subformData.location_id,
          inventory_category: subformData.category || balance.category,
        };
        const [outResult, inResult] = await Promise.all([
          this.db.collection("inventory_movement").add(outMovement),
          this.db.collection("inventory_movement").add(inMovement),
        ]);
        return [outResult, inResult];

      case "Miscellaneous Issue":
      case "Disposal/Scrap":
        const outData = {
          ...baseMovementData,
          movement: "OUT",
          bin_location_id: balance.location_id,
        };
        return await this.db.collection("inventory_movement").add(outData);

      case "Miscellaneous Receipt":
        const inData = {
          ...baseMovementData,
          movement: "IN",
          bin_location_id: subformData.location_id || balance.location_id,
          batch_number_id:
            materialData.item_batch_management == "1"
              ? baseMovementData.batch_number_id
              : null,
        };
        return await this.db.collection("inventory_movement").add(inData);

      case "Inventory Category Transfer Posting":
        const outMovementICT = {
          ...baseMovementData,
          movement: "OUT",
          inventory_category: balance.category_from,
          bin_location_id: balance.location_id,
        };
        const inMovementICT = {
          ...baseMovementData,
          movement: "IN",
          inventory_category: balance.category_to,
          bin_location_id: balance.location_id,
        };
        const [outResultICT, inResultICT] = await Promise.all([
          this.db.collection("inventory_movement").add(outMovementICT),
          this.db.collection("inventory_movement").add(inMovementICT),
        ]);
        return [outResultICT, inResultICT];

      default:
        const movement =
          movementType === "Inter Operation Facility Transfer" ? "IN" : "OUT";
        const binLocationId =
          movement === "IN"
            ? subformData.location_id || balance.location_id
            : balance.location_id;
        const movementData = {
          ...baseMovementData,
          movement,
          bin_location_id: binLocationId,
        };
        return await this.db.collection("inventory_movement").add(movementData);
    }
  }

  async preCheckQuantitiesAndCosting(allData, context) {
    try {
      console.log("Starting preCheckQuantitiesAndCosting with data:", allData);

      // Step 1: Validate top-level required fields
      try {
        const requiredTopLevelFields = [
          "stock_movement_no",
          "movement_type",
          "issue_date",
          "issuing_operation_faci",
        ];
        this.validateRequiredFields(allData, requiredTopLevelFields);
      } catch (error) {
        // Show required fields error as an alert
        if (context && context.parentGenerateForm) {
          context.parentGenerateForm.$alert(
            error.message,
            "Missing Required Fields",
            {
              confirmButtonText: "OK",
              type: "warning",
            }
          );
        } else {
          alert(error.message);
        }
        throw error; // Stop further processing
      }

      // Step 2: Get movement type details
      const movementTypeId = allData.movement_type;
      const response = await this.db
        .collection("stock_movement_type")
        .where({ id: movementTypeId })
        .get();
      if (!response.data[0]) {
        throw new Error("Invalid movement type ID");
      }
      const movementType = response.data[0].sm_type_name;

      // Step 3: Validate subform data
      const subformData = allData.stock_movement;
      if (!subformData || subformData.length === 0) {
        throw new Error("Stock movement items are required");
      }

      // Step 4: Perform item validations and quantity checks
      await this.preValidateItems(subformData, movementType, allData);

      // Step 5: Check quantities and costing records for deduction movements
      for (const item of subformData) {
        const materialResponse = await this.db
          .collection("Item")
          .where({ id: item.item_selection })
          .get();
        const materialData = materialResponse.data[0];
        if (!materialData) {
          throw new Error(`Material not found: ${item.item_selection}`);
        }
        if (!materialData.based_uom) {
          throw new Error(
            `Base UOM is missing for item ${item.item_selection}`
          );
        }
        const balancesToProcess =
          allData.balance_index?.filter(
            (balance) => balance.sm_quantity && balance.sm_quantity > 0
          ) || [];

        if (
          [
            "Miscellaneous Issue",
            "Disposal/Scrap",
            "Location Transfer",
            "Inventory Category Transfer Posting",
          ].includes(movementType)
        ) {
          for (const balance of balancesToProcess) {
            const collectionName =
              materialData.item_batch_management == "1"
                ? "item_batch_balance"
                : "item_balance";
            const balanceResponse = await this.db
              .collection(collectionName)
              .where({
                material_id: materialData.id,
                location_id: balance.location_id,
              })
              .get();
            const balanceData = balanceResponse.data[0];

            // if (!balanceData) {
            //     throw new Error(`No existing balance found for item ${item.item_selection} at location ${balance.location_id}`);
            // }

            const categoryField =
              this.categoryMap[balance.category || subformData.category];
            const currentQty = balanceData[categoryField] || 0;
            const requestedQty =
              balance.quantity_converted || balance.sm_quantity;

            if (currentQty < requestedQty) {
              throw new Error(
                `Insufficient quantity in ${
                  balance.category || "Unrestricted"
                } for item ${item.item_selection} at location ${
                  balance.location_id
                }. Available: ${currentQty}, Requested: ${requestedQty}`
              );
            }

            // Step 6: Check costing records for deduction
            if (
              ["Miscellaneous Issue", "Disposal/Scrap"].includes(movementType)
            ) {
              const costingMethod = materialData.material_costing_method;
              if (!costingMethod) {
                throw new Error(
                  `Costing method not defined for item ${item.item_selection}`
                );
              }

              if (costingMethod === "Weighted Average") {
                const waQuery =
                  materialData.item_batch_management == "1" && balance.batch_id
                    ? this.db.collection("wa_costing_method").where({
                        material_id: materialData.id,
                        batch_id: balance.batch_id,
                        plant_id: allData.issuing_operation_faci,
                      })
                    : this.db.collection("wa_costing_method").where({
                        material_id: materialData.id,
                        plant_id: allData.issuing_operation_faci,
                      });

                const waResponse = await waQuery.get();
                if (!waResponse.data || waResponse.data.length === 0) {
                  throw new Error(
                    `No costing record found for deduction for item ${item.item_selection} (Weighted Average)`
                  );
                }

                const waData = waResponse.data[0];
                if ((waData.wa_quantity || 0) < requestedQty) {
                  throw new Error(
                    `Insufficient WA quantity for item ${item.item_selection}. Available: ${waData.wa_quantity}, Requested: ${requestedQty}`
                  );
                }
              } else if (costingMethod === "First In First Out") {
                const fifoQuery =
                  materialData.item_batch_management == "1" && balance.batch_id
                    ? this.db.collection("fifo_costing_history").where({
                        material_id: materialData.id,
                        batch_id: balance.batch_id,
                      })
                    : this.db
                        .collection("fifo_costing_history")
                        .where({ material_id: materialData.id });

                const fifoResponse = await fifoQuery.get();
                if (!fifoResponse.data || fifoResponse.data.length === 0) {
                  throw new Error(
                    `No costing record found for deduction for item ${item.item_selection} (FIFO)`
                  );
                }

                const fifoData = fifoResponse.data;
                const totalAvailable = fifoData.reduce(
                  (sum, record) => sum + (record.fifo_available_quantity || 0),
                  0
                );
                if (totalAvailable < requestedQty) {
                  throw new Error(
                    `Insufficient FIFO quantity for item ${item.item_selection}. Available: ${totalAvailable}, Requested: ${requestedQty}`
                  );
                }
              }
            }
          }
        }
      }

      // Step 7: If all checks pass, show confirmation popup
      return true;
    } catch (error) {
      // Step 8: Handle errors (excluding required fields, which are handled above)
      console.error("Error in preCheckQuantitiesAndCosting:", error.message);
      // if (error.message.includes('Please fill in all required fields')) {
      //     // Skip popup for required fields errors, as they are already handled as alerts
      //     throw error;
      // }
      if (context && context.parentGenerateForm) {
        context.parentGenerateForm.$alert(error.message, "Validation Error", {
          confirmButtonText: "OK",
          type: "error",
        });
      } else {
        alert(error.message);
      }
      throw error;
    }
  }
}

// Modified processFormData to use preCheckQuantitiesAn`dCosting
async function processFormData(db, formData, context) {
  const adjuster = new StockAdjuster(db);
  let results;

  if (context) {
    adjuster.getParamsVariables = context.getParamsVariables.bind(context);
    adjuster.parentGenerateForm = context.parentGenerateForm;
  }

  const closeDialog = () => {
    if (context.parentGenerateForm) {
      context.parentGenerateForm.$refs.SuPageDialogRef.hide();
      context.parentGenerateForm.refresh();
    }
  };

  try {
    const isValid = await adjuster.preCheckQuantitiesAndCosting(
      formData,
      context
    );

    if (isValid) {
      results = await adjuster.processStockAdjustment(formData);
    }
    return results;
  } catch (error) {
    console.error("Error in processFormData:", error.message);
    throw error;
  } finally {
    closeDialog();
  }
}

// Example usage remains the same
const self = this;
const allData = self.getValues();

processFormData(db, allData, self)
  .then((results) => {
    if (self.getParamsVariables("page_status") === "Add") {
      console.log("New stock movement created:", results);
    } else if (self.getParamsVariables("page_status") === "Edit") {
      console.log("Stock movement updated:", results);
    }
  })
  .catch((error) => {
    alert(error.message);
    console.error("Error:", error);
  });
