class StockAdjuster {
  constructor(db) {
    this.db = db;
    this.categoryMap = {
      Unrestricted: "unrestricted_qty",
      "Quality Inspection": "qualityinsp_qty",
      Blocked: "block_qty",
      Reserved: "reserved_qty",
      "In Transit": "intransit_qty",
    };
  }

  validateRequiredFields(data, requiredFields, context = "") {
    const missingFields = requiredFields.filter(
      (field) => !data[field] && data[field] !== 0
    );
    if (missingFields.length > 0) {
      return `Please fill in all required fields marked with (*) ${context}: ${missingFields.join(
        ", "
      )}`;
    }
    return null;
  }

  async processStockAdjustment(db, self) {
    const errors = [];
    const stockMovementNo = self.getParamsVariables("stock_movement_no");
    const allData = self.getValues();

    // Step 1: Validate top-level required fields
    const requiredTopLevelFields = [
      "issuing_operation_faci",
      "stock_movement_no",
      "movement_type",
      "issue_date",
    ];
    const topLevelValidationError = this.validateRequiredFields(
      allData,
      requiredTopLevelFields
    );
    if (topLevelValidationError) {
      errors.push(topLevelValidationError);
    }

    // Step 2: Validate stock movement existence and fetch data
    let receivingData,
      issuingData,
      issuingStockMovementId,
      receivingStockMovementId,
      receivingStockMovementPlantId,
      receivingStockMovementNumber,
      issuingStockMovementPlantId,
      issuingStockMovementNo;
    try {
      const receivingResponse = await db
        .collection("stock_movement")
        .where({ id: stockMovementNo })
        .get();
      if (!receivingResponse.data[0]) {
        errors.push(
          `Receiving stock movement not found for ID: ${stockMovementNo}`
        );
      } else {
        receivingData = receivingResponse.data[0];
        issuingStockMovementId = receivingData.movement_id;
        receivingStockMovementId = receivingData.id;
        receivingStockMovementPlantId = receivingData.issuing_operation_faci;
        receivingStockMovementNumber = receivingData.stock_movement_no;

        const issuingResponse = await db
          .collection("stock_movement")
          .where({ id: issuingStockMovementId })
          .get();
        if (!issuingResponse.data[0]) {
          errors.push(
            `Issuing stock movement not found for ID: ${issuingStockMovementId}`
          );
        } else {
          issuingData = issuingResponse.data[0];
          issuingStockMovementPlantId = issuingData.issuing_operation_faci;
          issuingStockMovementNo = issuingData.stock_movement_no;
        }
      }
    } catch {
      errors.push(
        `Failed to fetch stock movement data for ID: ${stockMovementNo}`
      );
    }

    // Step 3: Validate stock movement items
    let processedItems = [];
    if (allData.stock_movement && allData.stock_movement.length > 0) {
      const itemValidationErrors = await this.validateStockMovementItems(
        allData
      );
      errors.push(...itemValidationErrors);
      processedItems = this.processStockMovementItems(allData);
    } else {
      errors.push("Stock movement items are required");
    }

    // Step 4: Display errors if any
    if (errors.length > 0) {
      const errorMessage = errors.join("\n");
      if (self && self.parentGenerateForm) {
        await self.parentGenerateForm.$alert(
          errorMessage,
          "Validation Errors",
          {
            confirmButtonText: "OK",
            type: "error",
          }
        );
      } else {
        alert(errorMessage);
      }
      throw new Error("Validation failed with multiple errors");
    }

    // Step 5: Show confirmation popup before proceeding
    return new Promise((resolve, reject) => {
      if (self && self.parentGenerateForm) {
        self.parentGenerateForm
          .$confirm(
            "All validations passed. Proceed with processing the stock movement?",
            "Confirm Stock Movement",
            {
              confirmButtonText: "Proceed",
              cancelButtonText: "Cancel",
              type: "success",
            }
          )
          .then(async () => {
            try {
              const updateResults = await this.updateRelatedTables(
                processedItems,
                issuingStockMovementNo,
                stockMovementNo,
                issuingStockMovementPlantId,
                receivingStockMovementPlantId,
                receivingStockMovementId,
                receivingStockMovementNumber,
                allData
              );
              resolve({
                receivingStockMovement: receivingData,
                issuingStockMovement: issuingData,
                ...updateResults,
              });
            } catch (err) {
              const processingErrors = [err.message];
              const errorMessage = processingErrors.join("\n");
              if (self && self.parentGenerateForm) {
                await self.parentGenerateForm.$alert(
                  errorMessage,
                  "Processing Errors",
                  {
                    confirmButtonText: "OK",
                    type: "error",
                  }
                );
              } else {
                alert(errorMessage);
              }
              reject(new Error("Processing failed with errors"));
            }
          })
          .catch(() => {
            reject(new Error("Stock movement cancelled by user"));
          });
      } else {
        console.warn("No context provided, proceeding without confirmation");
        this.updateRelatedTables(
          processedItems,
          issuingStockMovementNo,
          stockMovementNo,
          issuingStockMovementPlantId,
          receivingStockMovementPlantId,
          receivingStockMovementId,
          receivingStockMovementNumber,
          allData
        )
          .then((updateResults) => {
            resolve({
              receivingStockMovement: receivingData,
              issuingStockMovement: issuingData,
              ...updateResults,
            });
          })
          .catch((err) => {
            const errorMessage = `Processing failed: ${err.message}`;
            alert(errorMessage);
            reject(new Error("Processing failed with errors"));
          });
      }
    });
  }

  async validateStockMovementItems(allData) {
    const errors = [];
    for (const stockItem of allData.stock_movement) {
      const requiredFields = [
        "item_selection",
        "received_quantity",
        "total_quantity",
        "received_quantity_uom",
        "unit_price",
        "to_recv_qty",
      ];
      const itemValidationError = this.validateRequiredFields(
        stockItem,
        requiredFields,
        `for item ${stockItem.item_selection || "unknown"}`
      );
      if (itemValidationError) {
        errors.push(itemValidationError);
        continue;
      }

      // Fetch material data and validate
      try {
        const materialResponse = await this.db
          .collection("Item")
          .where({ id: stockItem.item_selection })
          .get();
        const materialData = materialResponse.data[0];
        if (!materialData) {
          errors.push(`Material not found for ID: ${stockItem.item_selection}`);
          continue;
        }
        if (!materialData.id) {
          errors.push(
            `Invalid material data: material_id is missing for item ${stockItem.item_selection}`
          );
          continue;
        }
        if (!materialData.material_costing_method) {
          errors.push(
            `Material costing method is not defined for item ${stockItem.item_selection}`
          );
          continue;
        }
        if (!allData.issuing_operation_faci) {
          errors.push(
            `Plant ID is required for costing update for item ${stockItem.item_selection}`
          );
          continue;
        }
      } catch {
        errors.push(
          `Failed to fetch material data for item ${stockItem.item_selection}`
        );
        continue;
      }

      // Validate balances
      const relatedBalances = allData.balance_index.filter(
        (balance) => balance.material_id === stockItem.item_selection
      );
      if (!relatedBalances.length) {
        errors.push(`No balances found for item ${stockItem.item_selection}`);
        continue;
      }

      for (const balance of relatedBalances) {
        const balanceRequiredFields = [
          "material_id",
          "balance_id",
          "sm_quantity",
          "intransit_qty",
        ];
        const balanceValidationError = this.validateRequiredFields(
          balance,
          balanceRequiredFields,
          `for balance of item ${stockItem.item_selection}`
        );
        if (balanceValidationError) {
          errors.push(balanceValidationError);
          continue;
        }

        // Validate intransit quantity
        try {
          const materialResponse = await this.db
            .collection("Item")
            .where({ id: balance.material_id })
            .get();
          const materialData = materialResponse.data[0];
          const collectionName =
            materialData.item_isbatch_managed == "1"
              ? "item_batch_balance"
              : "item_balance";
          const balanceResponse = await this.db
            .collection(collectionName)
            .where({ id: balance.balance_id })
            .get();
          const balanceData = balanceResponse.data[0];
          if (!balanceData) {
            errors.push(`Balance not found for ID: ${balance.balance_id}`);
            continue;
          }
          if ((balanceData.intransit_qty || 0) < stockItem.received_quantity) {
            errors.push(
              `Insufficient intransit quantity for item ${
                stockItem.item_selection
              }. Available: ${balanceData.intransit_qty || 0}, Requested: ${
                stockItem.received_quantity
              }`
            );
          }
        } catch {
          errors.push(
            `Failed to validate balance for item ${stockItem.item_selection}`
          );
        }
      }
    }
    return errors;
  }

  processStockMovementItems(allData) {
    const processedItems = [];

    allData.stock_movement.forEach((stockItem) => {
      const itemDetails = {
        item_selection: stockItem.item_selection,
        category: stockItem.category || "Unrestricted",
        location_id: stockItem.location_id,
        received_quantity: Number(stockItem.received_quantity) || 0,
        total_quantity: Number(stockItem.total_quantity) || 0,
        received_quantity_uom: stockItem.received_quantity_uom,
        unit_price: Number(stockItem.unit_price) || 0,
        to_recv_qty: Number(stockItem.to_recv_qty) || 0,
      };

      const relatedBalances = allData.balance_index
        .filter((balance) => balance.material_id === stockItem.item_selection)
        .map((balance) => ({
          material_id: balance.material_id,
          balance_id: balance.balance_id,
          category: itemDetails.category,
          location_id: itemDetails.location_id,
          received_quantity: itemDetails.received_quantity,
          unit_price: itemDetails.unit_price,
          received_quantity_uom: itemDetails.received_quantity_uom,
          to_recv_qty: itemDetails.to_recv_qty,
          quantities: {
            sm_quantity: balance.sm_quantity,
            intransit_qty: balance.intransit_qty,
          },
        }));

      processedItems.push({
        itemDetails,
        balances: relatedBalances,
      });
    });
    console.log("processedItems", processedItems);
    return processedItems;
  }

  async updateRelatedTables(
    processedItems,
    issuingStockMovementNo,
    stockMovementNo,
    issuingPlantId,
    receivingPlantId,
    receivingStockMovementId,
    receivingStockMovementNumber,
    allData
  ) {
    const results = {
      balanceUpdates: [],
      inventoryMovements: [],
      costingUpdates: [],
      stockMovementUpdates: {
        issuing: null,
        receiving: null,
      },
    };
    const errors = [];

    for (const item of processedItems) {
      const { itemDetails, balances } = item;

      for (const balance of balances) {
        try {
          const issuingBalanceUpdate = await this.updateIssuingBalance(
            balance.balance_id,
            balance.material_id,
            balance.received_quantity,
            balance.unit_price,
            balance.received_quantity_uom
          );
          results.balanceUpdates.push({ issuing: issuingBalanceUpdate });
        } catch (err) {
          errors.push(
            `Failed to update issuing balance for item ${balance.material_id}: ${err.message}`
          );
          continue;
        }

        try {
          const receivingBalanceUpdate = await this.updateReceivingBalance(
            balance.material_id,
            receivingPlantId,
            balance.location_id,
            balance.received_quantity,
            balance.category,
            balance.unit_price,
            balance.received_quantity_uom
          );
          results.balanceUpdates[results.balanceUpdates.length - 1].receiving =
            receivingBalanceUpdate;
        } catch (err) {
          errors.push(
            `Failed to update receiving balance for item ${balance.material_id}: ${err.message}`
          );
          continue;
        }

        try {
          const inventoryMovement = await this.recordInventoryMovement(
            balance.material_id,
            balance.received_quantity,
            balance.category,
            balance.location_id,
            issuingStockMovementNo,
            stockMovementNo,
            issuingPlantId,
            receivingPlantId,
            receivingStockMovementId,
            receivingStockMovementNumber,
            balance.unit_price,
            balance.received_quantity_uom
          );
          results.inventoryMovements.push(inventoryMovement);
        } catch (err) {
          errors.push(
            `Failed to record inventory movement for item ${balance.material_id}: ${err.message}`
          );
          continue;
        }

        try {
          const costingUpdate = await this.updateCosting(
            balance.material_id,
            balance.received_quantity,
            issuingPlantId,
            receivingPlantId,
            balance.unit_price,
            balance.received_quantity_uom
          );
          results.costingUpdates.push(costingUpdate);
        } catch (err) {
          errors.push(
            `Failed to update costing for item ${balance.material_id}: ${err.message}`
          );
          continue;
        }
      }
    }

    // Update stock movement status
    const allComplete = processedItems.every(
      (item) =>
        item.itemDetails.received_quantity === item.itemDetails.total_quantity
    );
    const status = allComplete ? "Completed" : "In Progress";

    try {
      const issuingStockMovementResponse = await this.db
        .collection("stock_movement")
        .where({ stock_movement_no: issuingStockMovementNo })
        .get();
      const issuingStockMovement = issuingStockMovementResponse.data[0];

      if (issuingStockMovement) {
        await this.db
          .collection("stock_movement")
          .doc(issuingStockMovement.id)
          .update({
            stock_movement_status: status,
            update_time: new Date().toISOString(),
          });

        const updatedIssuingStockMovementResponse = await this.db
          .collection("stock_movement")
          .doc(issuingStockMovement.id)
          .get();
        results.stockMovementUpdates.issuing =
          updatedIssuingStockMovementResponse.data[0];
      } else {
        errors.push(
          `Issuing stock movement not found for stock_movement_no: ${issuingStockMovementNo}`
        );
      }
    } catch (err) {
      errors.push(`Failed to update issuing stock movement: ${err.message}`);
    }

    try {
      const receivingStockMovementResponse = await this.db
        .collection("stock_movement")
        .where({ id: stockMovementNo })
        .get();
      const receivingStockMovement = receivingStockMovementResponse.data[0];

      if (receivingStockMovement) {
        const updatedStockMovementItems = processedItems.map((item) => {
          const itemDetails = item.itemDetails;
          const receivedQty = Number(itemDetails.received_quantity) || 0;
          const toRecvQty = Number(itemDetails.to_recv_qty) || 0;
          return {
            item_selection: itemDetails.item_selection,
            category: itemDetails.category || "Unrestricted",
            location_id: itemDetails.location_id || null,
            received_quantity: receivedQty,
            total_quantity: Number(itemDetails.total_quantity) || 0,
            received_quantity_uom: itemDetails.received_quantity_uom || null,
            unit_price: Number(itemDetails.unit_price) || 0,
            to_recv_qty: toRecvQty + receivedQty,
            amount: receivedQty * Number(itemDetails.unit_price) || 0,
          };
        });

        await this.db
          .collection("stock_movement")
          .doc(receivingStockMovementId)
          .update({
            stock_movement_status: status,
            stock_movement: updatedStockMovementItems,
            update_time: new Date().toISOString(),
          });

        const updatedReceivingStockMovementResponse = await this.db
          .collection("stock_movement")
          .doc(receivingStockMovementId)
          .get();
        results.stockMovementUpdates.receiving =
          updatedReceivingStockMovementResponse.data[0];
      } else {
        errors.push(
          `Receiving stock movement not found for id: ${stockMovementNo}`
        );
      }
    } catch (err) {
      errors.push(`Failed to update receiving stock movement: ${err.message}`);
    }

    if (errors.length > 0) {
      throw new Error(errors.join("; "));
    }

    return results;
  }

  async updateIssuingBalance(
    balanceId,
    materialId,
    receivedQuantity,
    unitPrice,
    uom
  ) {
    let materialData;
    try {
      const materialResponse = await this.db
        .collection("Item")
        .where({ id: materialId })
        .get();
      materialData = materialResponse.data[0];
      if (!materialData) {
        throw new Error(`Material not found for ID: ${materialId}`);
      }
    } catch (err) {
      throw new Error(`Failed to fetch material: ${err.message}`);
    }

    const collectionName =
      materialData.item_isbatch_managed == "1"
        ? "item_batch_balance"
        : "item_balance";
    let balanceData;
    try {
      const balanceResponse = await this.db
        .collection(collectionName)
        .where({ id: balanceId })
        .get();
      balanceData = balanceResponse.data[0];
      if (!balanceData) {
        throw new Error(`Balance not found for ID: ${balanceId}`);
      }
    } catch (err) {
      throw new Error(`Failed to fetch balance: ${err.message}`);
    }

    const updateData = {
      intransit_qty: (balanceData.intransit_qty || 0) - receivedQuantity,
      balance_quantity: (balanceData.balance_quantity || 0) - receivedQuantity,
      update_time: new Date().toISOString(),
    };

    try {
      await this.db
        .collection(collectionName)
        .doc(balanceId)
        .update(updateData);
    } catch (err) {
      throw new Error(`Failed to update issuing balance: ${err.message}`);
    }

    return { balanceId, ...updateData };
  }

  async updateReceivingBalance(
    materialId,
    plantId,
    locationId,
    receivedQuantity,
    category,
    unitPrice,
    uom
  ) {
    let materialData;
    try {
      const materialResponse = await this.db
        .collection("Item")
        .where({ id: materialId })
        .get();
      materialData = materialResponse.data[0];
      if (!materialData) {
        throw new Error(`Material not found for ID: ${materialId}`);
      }
    } catch (err) {
      throw new Error(`Failed to fetch material: ${err.message}`);
    }

    const collectionName =
      materialData.item_isbatch_managed == "1"
        ? "item_batch_balance"
        : "item_balance";
    const categoryField = this.categoryMap[category];

    let balanceData;
    try {
      const balanceResponse = await this.db
        .collection(collectionName)
        .where({
          material_id: materialId,
          plant_id: plantId,
          location_id: locationId,
        })
        .get();
      balanceData = balanceResponse.data[0];
    } catch (err) {
      throw new Error(`Failed to fetch receiving balance: ${err.message}`);
    }

    if (balanceData) {
      const updateData = {
        balance_quantity:
          (balanceData.balance_quantity || 0) + receivedQuantity,
        [categoryField]: (balanceData[categoryField] || 0) + receivedQuantity,
        update_time: new Date().toISOString(),
      };

      try {
        await this.db
          .collection(collectionName)
          .doc(balanceData.id)
          .update(updateData);
        return { balanceId: balanceData.id, ...updateData };
      } catch (err) {
        throw new Error(`Failed to update receiving balance: ${err.message}`);
      }
    } else {
      const newBalanceData = {
        material_id: materialId,
        plant_id: plantId,
        location_id: locationId,
        balance_quantity: receivedQuantity,
        [categoryField]: receivedQuantity,
        unrestricted_qty: category === "Unrestricted" ? receivedQuantity : 0,
        qualityinsp_qty:
          category === "Quality Inspection" ? receivedQuantity : 0,
        block_qty: category === "Blocked" ? receivedQuantity : 0,
        reserved_qty: category === "Reserved" ? receivedQuantity : 0,
        intransit_qty: 0,
        create_time: new Date().toISOString(),
        update_time: new Date().toISOString(),
        organization_id: materialData.organization_id || "default_org",
      };

      try {
        const response = await this.db
          .collection(collectionName)
          .add(newBalanceData);
        return { balanceId: response.data[0].id, ...newBalanceData };
      } catch (err) {
        throw new Error(`Failed to create receiving balance: ${err.message}`);
      }
    }
  }

  async recordInventoryMovement(
    materialId,
    quantity,
    category,
    locationId,
    issuingStockMovementNo,
    stockMovementNo,
    issuingPlantId,
    receivingPlantId,
    receivingStockMovementId,
    receivingStockMovementNumber,
    unitPrice,
    uom
  ) {
    let materialData;
    try {
      const materialResponse = await this.db
        .collection("Item")
        .where({ id: materialId })
        .get();
      materialData = materialResponse.data[0];
      if (!materialData) {
        throw new Error(`Material not found for ID: ${materialId}`);
      }
    } catch (err) {
      throw new Error(`Failed to fetch material: ${err.message}`);
    }

    const outMovement = {
      transaction_type: "SM",
      trx_no: issuingStockMovementNo,
      movement: "OUT",
      inventory_category: "In Transit",
      parent_trx_no: null,
      unit_price: unitPrice || 0,
      total_price: unitPrice * quantity || 0,
      quantity: quantity,
      item_id: materialId,
      uom_id: uom,
      base_qty: quantity,
      base_uom_id: uom,
      bin_location_id: locationId,
      batch_number_id:
        materialData.item_isbatch_managed == "1" ? materialId : null,
      costing_method_id: materialData.material_costing_method,
      organization_id: materialData.organization_id || "default_org",
      plant_id: issuingPlantId,
      created_at: new Date(),
    };

    const inMovement = {
      transaction_type: "SM",
      trx_no: receivingStockMovementNumber,
      parent_trx_no: null,
      movement: "IN",
      unit_price: unitPrice || 0,
      total_price: unitPrice * quantity || 0,
      quantity: quantity,
      item_id: materialId,
      inventory_category: category,
      uom_id: uom,
      base_qty: quantity,
      base_uom_id: uom,
      bin_location_id: locationId,
      batch_number_id:
        materialData.item_isbatch_managed == "1" ? materialId : null,
      costing_method_id: materialData.material_costing_method,
      created_at: new Date(),
      plant_id: issuingPlantId,
      organization_id: materialData.organization_id || "default_org",
    };

    try {
      const [outResult, inResult] = await Promise.all([
        this.db.collection("inventory_movement").add(outMovement),
        this.db.collection("inventory_movement").add(inMovement),
      ]);
      return {
        out: outResult.data[0],
        in: inResult.data[0],
      };
    } catch (err) {
      throw new Error(`Failed to record inventory movement: ${err.message}`);
    }
  }

  async updateCosting(
    materialId,
    receivedQuantity,
    issuingPlantId,
    receivingPlantId,
    unitPrice,
    uom
  ) {
    const costingUpdates = {};

    // Input validation
    if (!materialId || !issuingPlantId || !receivingPlantId) {
      throw new Error(
        "Material ID, issuing plant ID, and receiving plant ID are required"
      );
    }
    if (receivedQuantity <= 0 || unitPrice < 0) {
      throw new Error("Invalid quantity or unit price");
    }

    // Fetch material data
    const materialResponse = await this.db
      .collection("Item")
      .where({ id: materialId })
      .get();
    const materialData = materialResponse.data[0];
    if (!materialData) {
      throw new Error(`Material not found for ID: ${materialId}`);
    }

    const organizationId = materialData.organization_id || "default_org";

    if (materialData.material_costing_method === "Weighted Average") {
      // Issuing plant (deduct)
      const waIssuingResponse = await this.db
        .collection("wa_costing_method")
        .where({ material_id: materialId, plant_id: issuingPlantId })
        .get();
      let waData = waIssuingResponse.data || [];
      if (waData.length > 0) {
        waData.sort((a, b) => {
          if (a.created_at && b.created_at) {
            return new Date(b.created_at) - new Date(a.created_at);
          }
          return 0;
        });

        const waDoc = waData[0];
        const waCostPrice = parseFloat(waDoc.wa_cost_price || 0);
        const waQuantity = parseFloat(waDoc.wa_quantity || 0);

        if (waQuantity < receivedQuantity) {
          console.warn(
            `Warning: Cannot fully update weighted average for ${materialId} - ` +
              `Available: ${waQuantity}, Requested: ${receivedQuantity}`
          );

          if (waQuantity <= 0) {
            costingUpdates.issuingWA = { id: waDoc.id, wa_quantity: 0 };
            return costingUpdates; // Early return if no quantity available
          }
        }

        const newWaQuantity = Math.max(0, waQuantity - receivedQuantity);

        if (newWaQuantity === 0) {
          await this.db.collection("wa_costing_method").doc(waDoc.id).update({
            wa_quantity: 0,
            updated_at: new Date(),
          });
          console.log(
            `Updated Weighted Average for item ${materialId} to zero quantity`
          );
          costingUpdates.issuingWA = { id: waDoc.id, wa_quantity: 0 };
        } else {
          const calculatedWaCostPrice =
            (waCostPrice * waQuantity - waCostPrice * receivedQuantity) /
            newWaQuantity;
          const newWaCostPrice =
            Math.round(calculatedWaCostPrice * 10000) / 10000;

          await this.db.collection("wa_costing_method").doc(waDoc.id).update({
            wa_quantity: newWaQuantity,
            wa_cost_price: newWaCostPrice,
            updated_at: new Date(),
          });
          console.log(
            `Issuing Plant: Updated ${materialId} from wa_quantity=${waQuantity} to ${newWaQuantity}, ` +
              `wa_cost_price=${newWaCostPrice}`
          );
          costingUpdates.issuingWA = {
            id: waDoc.id,
            wa_quantity: newWaQuantity,
            wa_cost_price: newWaCostPrice,
          };
        }
      }

      // Receiving plant (add)
      const waReceivingResponse = await this.db
        .collection("wa_costing_method")
        .where({ material_id: materialId, plant_id: receivingPlantId })
        .get();
      const waReceivingData = waReceivingResponse.data[0];
      if (waReceivingData) {
        const existingQuantity = waReceivingData.wa_quantity || 0;
        const existingCostPrice = waReceivingData.wa_cost_price || 0;
        const newQuantity = existingQuantity + receivedQuantity;

        const newCostPrice =
          (existingQuantity * existingCostPrice +
            receivedQuantity * unitPrice) /
          newQuantity;
        const roundedNewCostPrice = Math.round(newCostPrice * 10000) / 10000;

        await this.db
          .collection("wa_costing_method")
          .doc(waReceivingData.id)
          .update({
            wa_quantity: newQuantity,
            wa_cost_price: roundedNewCostPrice,
            updated_at: new Date(),
          });
        console.log(
          `Receiving Plant: Updated ${materialId} from wa_quantity=${existingQuantity} to ${newQuantity}, ` +
            `wa_cost_price=${roundedNewCostPrice}`
        );
        costingUpdates.receivingWA = {
          id: waReceivingData.id,
          wa_quantity: newQuantity,
          wa_cost_price: roundedNewCostPrice,
        };
      } else {
        const newWAData = {
          material_id: materialId,
          plant_id: receivingPlantId,
          wa_quantity: receivedQuantity,
          wa_cost_price: Number(unitPrice).toFixed(4),
          organization_id: organizationId,
          created_at: new Date(),
          updated_at: new Date(),
        };
        const newWAResponse = await this.db
          .collection("wa_costing_method")
          .add(newWAData);
        console.log(
          `Receiving Plant: Created WA record for ${materialId}, wa_quantity=${receivedQuantity}, wa_cost_price=${newWAData.wa_cost_price}`
        );
        costingUpdates.receivingWA = {
          id: newWAResponse.data[0].id,
          ...newWAData,
        };
      }
    } else if (materialData.material_costing_method === "First In First Out") {
      // Issuing Plant (deduct)
      const fifoIssuingResponse = await this.db
        .collection("fifo_costing_history")
        .where({ material_id: materialId, plant_id: issuingPlantId })
        .get();
      let fifoIssuingData = fifoIssuingResponse.data || [];
      if (fifoIssuingData.length && receivedQuantity > 0) {
        let remainingReduction = receivedQuantity;
        fifoIssuingData.sort((a, b) => a.fifo_sequence - b.fifo_sequence);

        for (const fifoRecord of fifoIssuingData) {
          if (remainingReduction <= 0) break;

          const available = fifoRecord.fifo_available_quantity;
          const reduction = Math.min(available, remainingReduction);
          const newAvailable = available - reduction;

          await this.db
            .collection("fifo_costing_history")
            .doc(fifoRecord.id)
            .update({
              fifo_available_quantity: newAvailable,
              updated_at: new Date(),
            });
          console.log(
            `Issuing Plant: Updated ${materialId} FIFO record ${fifoRecord.id}, ` +
              `fifo_available_quantity from ${available} to ${newAvailable}`
          );
          costingUpdates.issuingFIFO = costingUpdates.issuingFIFO || [];
          costingUpdates.issuingFIFO.push({
            id: fifoRecord.id,
            fifo_available_quantity: newAvailable,
            fifo_cost_price: fifoRecord.fifo_cost_price,
          });

          remainingReduction -= reduction;
        }

        if (remainingReduction > 0) {
          throw new Error("Insufficient FIFO quantity at issuing plant");
        }
      }

      // Replenish Issuing Plant (Plant A)
      const fifoIssuingResponseAfter = await this.db
        .collection("fifo_costing_history")
        .where({ material_id: materialId, plant_id: issuingPlantId })
        .get();
      const fifoIssuingDataAfter = fifoIssuingResponseAfter.data || [];
      let sequenceNumberIssuing = 1;
      if (fifoIssuingDataAfter.length) {
        const existingSequences = fifoIssuingDataAfter.map((doc) =>
          parseInt(doc.fifo_sequence || 0)
        );
        sequenceNumberIssuing = Math.max(...existingSequences, 0) + 1;
      }
      // Use issuing plant's cost price if available, else unitPrice
      const issuingCostPrice = fifoIssuingData.length
        ? fifoIssuingData[0].fifo_cost_price
        : unitPrice;
      const newFifoDataIssuing = {
        fifo_cost_price: Number(issuingCostPrice).toFixed(4),
        fifo_initial_quantity: receivedQuantity,
        fifo_available_quantity: receivedQuantity,
        material_id: materialId,
        batch_id: materialData.item_isbatch_managed === "1" ? materialId : null,
        fifo_sequence: sequenceNumberIssuing,
        plant_id: issuingPlantId,
        organization_id: organizationId,
        created_at: new Date(),
        updated_at: new Date(),
      };
      const newFifoResponseIssuing = await this.db
        .collection("fifo_costing_history")
        .add(newFifoDataIssuing);
      console.log(
        `Issuing Plant: Created FIFO record for ${materialId}, ` +
          `fifo_available_quantity=${receivedQuantity}, fifo_cost_price=${newFifoDataIssuing.fifo_cost_price}, ` +
          `fifo_sequence=${sequenceNumberIssuing}`
      );
      costingUpdates.issuingFIFO = costingUpdates.issuingFIFO || [];
      costingUpdates.issuingFIFO.push({
        id: newFifoResponseIssuing.data[0].id,
        ...newFifoDataIssuing,
      });

      // Receiving Plant (add)
      const fifoReceivingResponse = await this.db
        .collection("fifo_costing_history")
        .where({ material_id: materialId, plant_id: receivingPlantId })
        .get();
      const fifoReceivingData = fifoReceivingResponse.data || [];
      let sequenceNumber = 1;
      if (fifoReceivingData.length) {
        const existingSequences = fifoReceivingData.map((doc) =>
          parseInt(doc.fifo_sequence || 0)
        );
        sequenceNumber = Math.max(...existingSequences, 0) + 1;
      }

      const newFifoData = {
        fifo_cost_price: Number(issuingCostPrice).toFixed(4), // Use issuing plant’s cost price
        fifo_initial_quantity: receivedQuantity,
        fifo_available_quantity: receivedQuantity,
        material_id: materialId,
        batch_id: materialData.item_isbatch_managed === "1" ? materialId : null,
        fifo_sequence: sequenceNumber,
        plant_id: receivingPlantId,
        organization_id: organizationId,
        created_at: new Date(),
        updated_at: new Date(),
      };
      const newFifoResponse = await this.db
        .collection("fifo_costing_history")
        .add(newFifoData);
      console.log(
        `Receiving Plant: Created FIFO record for ${materialId}, ` +
          `fifo_available_quantity=${receivedQuantity}, fifo_cost_price=${newFifoData.fifo_cost_price}, ` +
          `fifo_sequence=${sequenceNumber}`
      );
      costingUpdates.receivingFIFO = {
        id: newFifoResponse.data[0].id,
        ...newFifoData,
      };
    } else {
      throw new Error(
        `Unsupported costing method: ${materialData.material_costing_method}`
      );
    }

    return costingUpdates;
  }
}

async function processFormData(db, self) {
  const adjuster = new StockAdjuster(db);
  const closeDialog = () => {
    if (self.parentGenerateForm) {
      self.parentGenerateForm.$refs.SuPageDialogRef.hide();
      self.parentGenerateForm.refresh();
    }
  };

  try {
    const results = await adjuster.processStockAdjustment(db, self);
    closeDialog();
    console.log("Stock movement processed:", results);
    return results;
  } catch (error) {
    console.error("Error processing stock adjustment:", error.message);
    throw error; // Error already displayed in processStockAdjustment
  }
}

const self = this;
processFormData(db, self)
  .then((results) => console.log("Success:", results))
  .catch((error) => console.error("Error:", error.message));
