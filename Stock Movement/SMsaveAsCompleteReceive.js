class ReceivingIOFTProcessor {
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

  // Helper functions for consistent decimal formatting
  roundQty(value) {
    return Number(Number(value).toFixed(3));
  }

  roundPrice(value) {
    return Number(Number(value).toFixed(4));
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

  async processReceivingIOFT(db, self, organizationId) {
    const errors = [];
    const allData = self.getValues();
    const stockMovementId = allData.id;
    // Step 1: Validate and fetch receiving IOFT data
    let receivingIOFT, receivingIOFTId, issuingIOFT, issuingIOFTId;
    try {
      const receivingResponse = await db
        .collection("stock_movement")
        .where({ id: stockMovementId })
        .get();

      if (!receivingResponse.data || receivingResponse.data.length === 0) {
        errors.push(`Receiving IOFT not found for ID: ${stockMovementId}`);
      } else {
        receivingIOFT = receivingResponse.data[0];
        receivingIOFTId = receivingIOFT.id;
        console.log("Receiving IOFT", receivingIOFT);

        const issuingId = receivingIOFT.movement_id;

        const issuingResponse = await db
          .collection("stock_movement")
          .where({ id: issuingId })
          .get();

        if (!issuingResponse.data || issuingResponse.data.length === 0) {
          errors.push(`Issuing IOFT not found for number: ${issuingId}`);
        } else {
          issuingIOFT = issuingResponse.data[0];
          issuingIOFTId = issuingIOFT.id;
          console.log("Issuing IOFT", issuingIOFT);
        }
      }
    } catch (error) {
      errors.push(`Error fetching IOFT data: ${error.message}`);
    }

    // Step 2: Process the items for receiving
    const processedItems = [];
    if (
      receivingIOFT.stock_movement &&
      receivingIOFT.stock_movement.length > 0
    ) {
      const processedTableSM = [];
      for (const [index, item] of receivingIOFT.stock_movement.entries()) {
        await self.validate(`stock_movement.${index}.batch_id`);

        const processedItem = await this.processRow(item, organizationId);
        processedTableSM.push(processedItem);
        console.log("processedItem", processedItem);
      }

      console.log("processedTableSM", processedTableSM);

      // Wait for all processRow calls to complete
      receivingIOFT.stock_movement = processedTableSM;

      for (const item of receivingIOFT.stock_movement) {
        try {
          // Fetch material data
          const materialResponse = await this.db
            .collection("Item")
            .where({ id: item.item_selection })
            .get();

          if (!materialResponse.data || materialResponse.data.length === 0) {
            errors.push(`Material not found for ID: ${item.item_selection}`);
            continue;
          }

          const materialData = materialResponse.data[0];

          // Check if the material has sufficient in-transit quantity
          const isBatchManaged =
            materialData.item_batch_management == "1" ||
            materialData.item_isbatch_managed == "1";

          const collectionName = isBatchManaged
            ? "item_batch_balance"
            : "item_balance";

          // Find the balance at the issuing plant with in-transit quantity
          const balanceResponse = await this.db
            .collection(collectionName)
            .where({
              material_id: item.item_selection,
              plant_id: issuingIOFT.issuing_operation_faci,
            })
            .get();

          if (!balanceResponse.data || balanceResponse.data.length === 0) {
            errors.push(
              `No balance found for material ${item.item_selection} at issuing plant`
            );
            continue;
          }

          // Collect all balances with in-transit quantity
          const validBalances = balanceResponse.data.filter(
            (balance) => (balance.intransit_qty || 0) > 0
          );

          if (validBalances.length === 0) {
            errors.push(
              `No in-transit quantity available for material ${item.item_selection}`
            );
            continue;
          }

          // Add to processed items
          processedItems.push({
            item,
            materialData,
            balances: validBalances,
          });

          console.log("processedItems", processedItems);
        } catch (error) {
          errors.push(
            `Error processing item ${item.item_selection}: ${error.message}`
          );
        }
      }
    } else {
      errors.push("No items found in the stock movement");
    }

    // Step 3: Display errors if any
    if (errors.length > 0) {
      const errorMessage = errors.join("\n");
      if (self && self.parentGenerateForm) {
        self.hideLoading();
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

    // Step 4: Show confirmation popup before proceeding
    return new Promise((resolve, reject) => {
      if (self && self.parentGenerateForm) {
        self.parentGenerateForm
          .$confirm(
            "All validations passed. Proceed with receiving the IOFT?",
            "Confirm IOFT Receipt",
            {
              confirmButtonText: "Proceed",
              cancelButtonText: "Cancel",
              type: "success",
            }
          )
          .then(async () => {
            try {
              const results = await this.updateRelatedTables(
                receivingIOFTId,
                issuingIOFTId,
                processedItems,
                receivingIOFT,
                issuingIOFT,
                organizationId
              );
              resolve(results);
            } catch (err) {
              const processingErrors = [err.message];
              const errorMessage = processingErrors.join("\n");
              if (self && self.parentGenerateForm) {
                self.hideLoading();
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
            reject(new Error("IOFT receipt cancelled by user"));
          });
      } else {
        console.warn("No context provided, proceeding without confirmation");
        this.updateRelatedTables(
          receivingIOFTId,
          issuingIOFTId,
          processedItems,
          receivingIOFT,
          issuingIOFT,
          organizationId
        )
          .then((results) => {
            resolve(results);
          })
          .catch((err) => {
            const errorMessage = `Processing failed: ${err.message}`;
            self.hideLoading();
            alert(errorMessage);
            reject(new Error("Processing failed with errors"));
          });
      }
    });
  }

  async processRow(item, organizationId) {
    if (item.batch_id === "Auto-generated batch number") {
      const resBatchConfig = await this.db
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

        item.batch_id = generatedBatchNo;
        console.log("batch id", generatedBatchNo);
        await this.db
          .collection("batch_level_config")
          .where({ id: batchConfigData.id })
          .update({
            batch_running_number: batchConfigData.batch_running_number + 1,
          });

        return item;
      }
    } else {
      return item;
    }
  }

  async updateRelatedTables(
    receivingIOFTId,
    issuingIOFTId,
    processedItems,
    receivingIOFT,
    issuingIOFT,
    organizationId
  ) {
    const results = {
      balanceUpdates: {
        issuing: [],
        receiving: [],
      },
      inventoryMovements: {
        issuing: [],
        receiving: [],
      },
      costingUpdates: {
        issuing: [],
        receiving: [],
      },
      stockMovementUpdates: {
        issuing: null,
        receiving: null,
      },
    };
    const errors = [];

    console.log("processedItems JN", processedItems);

    // Process each item
    for (const { item, materialData, balances } of processedItems) {
      const quantityToReceive = Number(item.total_quantity);
      let remainingQuantity = quantityToReceive;

      // Process against each balance until the full quantity is covered
      for (const balance of balances) {
        if (remainingQuantity <= 0) break;

        const availableInTransit = Number(balance.intransit_qty || 0);
        const quantityFromThisBalance = Math.min(
          availableInTransit,
          remainingQuantity
        );

        let batchId = "";

        if (quantityFromThisBalance <= 0) continue;

        if (materialData.item_batch_management === 1) {
          const batchData = {
            batch_number: item.batch_id,
            material_id: item.item_selection,
            initial_quantity: this.roundQty(quantityFromThisBalance),
            transaction_no: receivingIOFT.stock_movement_no,
            parent_transaction_no: issuingIOFT.stock_movement_no,
            plant_id: receivingIOFT.issuing_operation_faci,
            organization_id: organizationId,
          };

          await this.db.collection("batch").add(batchData);
          await new Promise((resolve) => setTimeout(resolve, 300));

          const response = await this.db
            .collection("batch")
            .where({
              batch_number: item.batch_id,
              material_id: item.item_selection,
              transaction_no: receivingIOFT.stock_movement_no,
              parent_transaction_no: issuingIOFT.stock_movement_no,
            })
            .get();

          const batchResult = response.data;

          batchId = batchResult[0].id;
        }

        console.log("batchId", batchId);

        try {
          // 1. Update issuing plant balance (decrease in-transit)
          const issuingBalanceUpdate = await this.updateIssuingBalance(
            balance.id,
            materialData.id,
            quantityFromThisBalance
          );
          results.balanceUpdates.issuing.push(issuingBalanceUpdate);

          // 2. Update or create receiving plant balance (increase unrestricted)
          const receivingBalanceUpdate = await this.updateReceivingBalance(
            materialData.id,
            receivingIOFT.issuing_operation_faci, // This is the receiving plant ID
            item.location_id || balance.location_id,
            quantityFromThisBalance,
            item.category || "Unrestricted",
            item.unit_price,
            organizationId,
            batchId
          );
          results.balanceUpdates.receiving.push(receivingBalanceUpdate);

          // 3. Record inventory movements
          const inventoryMovements = await this.recordInventoryMovements(
            materialData.id,
            quantityFromThisBalance,
            "In Transit", // Source category at issuing plant
            item.category || "Unrestricted", // Target category at receiving plant
            item.location_id || balance.location_id,
            issuingIOFT.stock_movement_no,
            receivingIOFT.stock_movement_no,
            issuingIOFT.issuing_operation_faci,
            receivingIOFT.issuing_operation_faci,
            item.unit_price,
            item.received_quantity_uom,
            materialData,
            organizationId,
            item.temp_qty_data,
            batchId
          );
          results.inventoryMovements.issuing.push(
            inventoryMovements.issuingMovement
          );
          results.inventoryMovements.receiving.push(
            inventoryMovements.receivingMovement
          );

          // 4. Update costing records
          const costingUpdates = await this.updateCosting(
            materialData,
            quantityFromThisBalance,
            issuingIOFT.issuing_operation_faci,
            receivingIOFT.issuing_operation_faci,
            item.unit_price,
            organizationId
          );
          results.costingUpdates.issuing.push(costingUpdates.issuingCosting);
          results.costingUpdates.receiving.push(
            costingUpdates.receivingCosting
          );

          // Reduce remaining quantity
          remainingQuantity -= quantityFromThisBalance;
        } catch (error) {
          errors.push(
            `Error processing balance for item ${materialData.id}: ${error.message}`
          );
        }
      }

      // Check if all quantity was processed
      if (remainingQuantity > 0) {
        errors.push(
          `Could not process full quantity for item ${materialData.id}. Remaining: ${remainingQuantity}`
        );
      }
    }

    // Update receiving IOFT status to Completed
    try {
      console.log("receiving ioft", receivingIOFT.stock_movement);
      await this.db.collection("stock_movement").doc(receivingIOFTId).update({
        stock_movement_status: "Completed",
        stock_movement: receivingIOFT.stock_movement,
        update_time: new Date().toISOString(),
      });

      const updatedReceivingIOFT = await this.db
        .collection("stock_movement")
        .where({ id: receivingIOFTId })
        .get();

      console.log("Updated Receiving IOFT", updatedReceivingIOFT.data);

      results.stockMovementUpdates.receiving = updatedReceivingIOFT.data;
    } catch (error) {
      errors.push(`Error updating receiving IOFT status: ${error.message}`);
    }

    // Update issuing IOFT status to Completed
    try {
      await this.db.collection("stock_movement").doc(issuingIOFTId).update({
        stock_movement_status: "Completed",
        update_time: new Date().toISOString(),
      });

      const updatedIssuingIOFT = await this.db
        .collection("stock_movement")
        .where({ id: issuingIOFTId })
        .get();

      console.log("Updated Issuing IOFT", updatedIssuingIOFT.data);

      results.stockMovementUpdates.issuing = updatedIssuingIOFT.data;
    } catch (error) {
      errors.push(`Error updating issuing IOFT status: ${error.message}`);
    }

    if (errors.length > 0) {
      throw new Error(errors.join("; "));
    }

    return results;
  }

  async updateIssuingBalance(balanceId, materialId, quantity) {
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

    // Determine the collection based on whether the material is batch managed
    const isBatchManaged =
      materialData.item_batch_management == "1" ||
      materialData.item_isbatch_managed == "1";
    const collectionName = isBatchManaged
      ? "item_batch_balance"
      : "item_balance";

    // Fetch the current balance
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

    const formattedQuantity = this.roundQty(quantity);

    // Ensure we don't go below zero
    const currentInTransit = this.roundQty(balanceData.intransit_qty || 0);
    if (currentInTransit < formattedQuantity) {
      throw new Error(
        `Insufficient in-transit quantity. Available: ${currentInTransit}, Requested: ${formattedQuantity}`
      );
    }

    // Update balance - decrease in-transit quantity
    const updateData = {
      intransit_qty: this.roundQty(currentInTransit - formattedQuantity),
      balance_quantity: this.roundQty(
        (balanceData.balance_quantity || 0) - formattedQuantity
      ),
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

    return {
      balanceId,
      materialId,
      quantityReduced: formattedQuantity,
      ...updateData,
    };
  }

  async updateReceivingBalance(
    materialId,
    plantId,
    locationId,
    quantity,
    category = "Unrestricted",
    unitPrice,
    organizationId,
    batchId
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

    // Determine the collection based on whether the material is batch managed
    const isBatchManaged =
      materialData.item_batch_management == "1" ||
      materialData.item_isbatch_managed == "1";
    const collectionName = isBatchManaged
      ? "item_batch_balance"
      : "item_balance";

    const categoryField = this.categoryMap[category];
    if (!categoryField) {
      throw new Error(`Invalid category: ${category}`);
    }

    const formattedQuantity = this.roundQty(quantity);

    // Check if the balance already exists
    let balanceData;
    try {
      const balanceQuery = {
        material_id: materialId,
        plant_id: plantId,
        ...(isBatchManaged && { batch_id: batchId }),
      };

      if (locationId) {
        balanceQuery.location_id = locationId;
      }

      const balanceResponse = await this.db
        .collection(collectionName)
        .where(balanceQuery)
        .get();

      if (balanceResponse.data && balanceResponse.data.length > 0) {
        balanceData = balanceResponse.data[0];
      }
    } catch (err) {
      throw new Error(`Failed to fetch receiving balance: ${err.message}`);
    }

    // If balance exists, update it
    if (balanceData) {
      const currentCategoryQty = this.roundQty(balanceData[categoryField] || 0);
      const currentBalanceQty = this.roundQty(
        balanceData.balance_quantity || 0
      );

      const updateData = {
        [categoryField]: this.roundQty(currentCategoryQty + formattedQuantity),
        balance_quantity: this.roundQty(currentBalanceQty + formattedQuantity),
        update_time: new Date().toISOString(),
      };

      try {
        await this.db
          .collection(collectionName)
          .doc(balanceData.id)
          .update(updateData);

        return {
          balanceId: balanceData.id,
          materialId,
          quantityAdded: formattedQuantity,
          ...updateData,
        };
      } catch (err) {
        throw new Error(`Failed to update receiving balance: ${err.message}`);
      }
    }
    // If balance doesn't exist, create a new one
    else {
      // Initialize all category fields to 0
      const newBalanceData = {
        material_id: materialId,
        plant_id: plantId,
        batch_id: batchId,
        location_id: locationId,
        balance_quantity: formattedQuantity,
        unrestricted_qty: 0,
        qualityinsp_qty: 0,
        block_qty: 0,
        reserved_qty: 0,
        intransit_qty: 0,
        create_time: new Date().toISOString(),
        update_time: new Date().toISOString(),
        organization_id: organizationId,
      };

      // Set the specific category quantity
      newBalanceData[categoryField] = formattedQuantity;

      try {
        const response = await this.db
          .collection(collectionName)
          .add(newBalanceData);

        return {
          balanceId: response.data[0].id,
          materialId,
          quantityAdded: formattedQuantity,
          ...newBalanceData,
        };
      } catch (err) {
        throw new Error(`Failed to create receiving balance: ${err.message}`);
      }
    }
  }

  // Function to get latest FIFO cost price with available quantity check
  async getLatestFIFOCostPrice(materialData, batchId) {
    try {
      const query =
        materialData.item_batch_management == "1" && batchId
          ? this.db
              .collection("fifo_costing_history")
              .where({ material_id: materialData.id, batch_id: batchId })
          : this.db
              .collection("fifo_costing_history")
              .where({ material_id: materialData.id });

      const response = await query.get();
      const result = response.data;

      if (result && Array.isArray(result) && result.length > 0) {
        // Sort by FIFO sequence (lowest/oldest first, as per FIFO principle)
        const sortedRecords = result.sort(
          (a, b) => a.fifo_sequence - b.fifo_sequence
        );

        // First look for records with available quantity
        for (const record of sortedRecords) {
          const availableQty = this.roundQty(
            record.fifo_available_quantity || 0
          );
          if (availableQty > 0) {
            console.log(
              `Found FIFO record with available quantity: Sequence ${record.fifo_sequence}, Cost price ${record.fifo_cost_price}`
            );
            return this.roundPrice(record.fifo_cost_price || 0);
          }
        }

        // If no records with available quantity, use the most recent record
        console.warn(
          `No FIFO records with available quantity found for ${materialData.id}, using most recent cost price`
        );
        return this.roundPrice(
          sortedRecords[sortedRecords.length - 1].fifo_cost_price || 0
        );
      }

      console.warn(`No FIFO records found for material ${materialData.id}`);
      return 0;
    } catch (error) {
      console.error(
        `Error retrieving FIFO cost price for ${materialData.id}:`,
        error
      );
      return 0;
    }
  }

  // Function to get Weighted Average cost price
  async getWeightedAverageCostPrice(materialData, batchId) {
    try {
      const query =
        materialData.item_batch_management == "1" && batchId
          ? this.db
              .collection("wa_costing_method")
              .where({ material_id: materialData.id, batch_id: batchId })
          : this.db
              .collection("wa_costing_method")
              .where({ material_id: materialData.id });

      const response = await query.get();
      const waData = response.data;

      if (waData && Array.isArray(waData) && waData.length > 0) {
        // Sort by date (newest first) to get the latest record
        waData.sort((a, b) => {
          if (a.created_at && b.created_at) {
            return new Date(b.created_at) - new Date(a.created_at);
          }
          return 0;
        });

        return this.roundPrice(waData[0].wa_cost_price || 0);
      }

      console.warn(
        `No weighted average records found for material ${materialData.id}`
      );
      return 0;
    } catch (error) {
      console.error(
        `Error retrieving WA cost price for ${materialData.id}:`,
        error
      );
      return 0;
    }
  }

  async getFixedCostPrice(materialId) {
    const query = this.db.collection("Item").where({ id: materialId });
    const response = await query.get();
    const result = response.data;
    return this.roundPrice(result[0].purchase_unit_price || 0);
  }

  async recordInventoryMovements(
    materialId,
    quantity,
    sourceCategory,
    targetCategory,
    locationId,
    issuingStockMovementNo,
    receivingStockMovementNo,
    issuingPlantId,
    receivingPlantId,
    unitPrice,
    uom,
    materialData,
    organizationId,
    tempQtyData,
    batchId
  ) {
    const formattedQuantity = this.roundQty(quantity);
    const formattedUnitPrice = this.roundPrice(unitPrice || 0);
    const totalPrice = this.roundPrice(formattedUnitPrice * formattedQuantity);

    // Use the material's UOM if not specified
    const itemUom = uom || materialData.based_uom || materialData.uom_id;

    // Parse temp quantity data
    let tempQtyDataArray = [];
    try {
      tempQtyDataArray = JSON.parse(tempQtyData || "[]");
    } catch (error) {
      console.error("Failed to parse tempQtyData:", error);
      tempQtyDataArray = [];
    }

    // Create OUT movements from issuing plant
    const issuingMovements = [];
    const issuingMovementData = [];

    for (const data of tempQtyDataArray) {
      if (data.sm_quantity > 0) {
        // Fetch material data for this specific item
        let materialDataOUT;
        try {
          const materialResponse = await this.db
            .collection("Item")
            .where({ id: data.material_id })
            .get();
          materialDataOUT = materialResponse.data[0];
          if (!materialDataOUT) {
            throw new Error(`Material not found for ID: ${data.material_id}`);
          }
        } catch (err) {
          throw new Error(`Failed to fetch material: ${err.message}`);
        }

        // Check batch management for this specific material
        const isBatchManagedOUT =
          materialDataOUT.item_batch_management == "1" ||
          materialDataOUT.item_isbatch_managed == "1";

        // Get unit price based on costing method
        let unitPriceOUT = 0;
        if (materialDataOUT.material_costing_method === "First In First Out") {
          unitPriceOUT = await this.getLatestFIFOCostPrice(
            materialDataOUT,
            data.batch_id
          );
        } else if (
          materialDataOUT.material_costing_method === "Weighted Average"
        ) {
          unitPriceOUT = await this.getWeightedAverageCostPrice(
            materialDataOUT,
            data.batch_id
          );
        } else if (materialDataOUT.material_costing_method === "Fixed Cost") {
          unitPriceOUT = await this.getFixedCostPrice(materialDataOUT.id);
        }

        const formattedSmQuantityOUT = this.roundQty(data.sm_quantity);
        const formattedUnitPriceOUT = this.roundPrice(unitPriceOUT || 0);
        const totalPriceOUT = this.roundPrice(
          formattedUnitPriceOUT * formattedSmQuantityOUT
        );

        // Create OUT movement
        const issuingMovement = {
          transaction_type: "SM",
          trx_no: issuingStockMovementNo,
          movement: "OUT",
          inventory_category: sourceCategory,
          parent_trx_no: null,
          unit_price: formattedUnitPriceOUT,
          total_price: totalPriceOUT,
          quantity: formattedSmQuantityOUT,
          item_id: data.material_id,
          uom_id: materialDataOUT.based_uom || materialDataOUT.uom_id,
          base_qty: formattedSmQuantityOUT,
          base_uom_id: materialDataOUT.based_uom || materialDataOUT.uom_id,
          bin_location_id: data.location_id,
          batch_number_id: isBatchManagedOUT ? data.batch_id : null,
          costing_method_id: materialDataOUT.material_costing_method,
          organization_id: organizationId,
          plant_id: issuingPlantId,
          created_at: new Date(),
        };

        issuingMovements.push(issuingMovement);
        issuingMovementData.push(issuingMovement);
      }
    }

    // Create IN movement to receiving plant
    const receivingMovement = {
      transaction_type: "SM",
      trx_no: receivingStockMovementNo,
      parent_trx_no: issuingStockMovementNo || null,
      movement: "IN",
      unit_price: formattedUnitPrice,
      total_price: totalPrice,
      quantity: formattedQuantity,
      item_id: materialId,
      inventory_category: targetCategory,
      uom_id: itemUom,
      base_qty: formattedQuantity,
      base_uom_id: itemUom,
      bin_location_id: locationId,
      batch_number_id: batchId,
      costing_method_id: materialData.material_costing_method,
      created_at: new Date(),
      plant_id: receivingPlantId,
      organization_id: organizationId,
    };

    try {
      // Execute all database operations
      const issuingResults = await Promise.all(
        issuingMovements.map((movement) =>
          this.db.collection("inventory_movement").add(movement)
        )
      );

      const receivingResult = await this.db
        .collection("inventory_movement")
        .add(receivingMovement);

      // Return properly structured results
      return {
        issuingMovements: issuingResults.map((result, index) => ({
          id: result.data[0].id,
          ...issuingMovementData[index],
        })),
        receivingMovement: {
          id: receivingResult.data[0].id,
          ...receivingMovement,
        },
      };
    } catch (err) {
      throw new Error(`Failed to record inventory movements: ${err.message}`);
    }
  }

  async updateCosting(
    materialData,
    quantity,
    issuingPlantId,
    receivingPlantId,
    unitPrice,
    organizationId
  ) {
    const results = {
      issuingCosting: null,
      receivingCosting: null,
    };

    const formattedQuantity = this.roundQty(quantity);
    const formattedUnitPrice = this.roundPrice(unitPrice || 0);
    const totalValue = this.roundPrice(formattedQuantity * formattedUnitPrice);

    // Handle based on costing method
    if (materialData.material_costing_method === "Weighted Average") {
      // Process issuing plant (reduce in-transit)
      try {
        const waIssuingResponse = await this.db
          .collection("wa_costing_method")
          .where({
            material_id: materialData.id,
            plant_id: issuingPlantId,
          })
          .get();

        if (waIssuingResponse.data && waIssuingResponse.data.length > 0) {
          const waData = waIssuingResponse.data[0];
          const currentQuantity = this.roundQty(waData.wa_quantity || 0);
          const currentCostPrice = this.roundPrice(waData.wa_cost_price || 0);

          // Reduce quantity but maintain cost price in issuing plant
          // Since we're just reducing in-transit quantity
          const newQuantity = Math.max(0, currentQuantity - formattedQuantity);

          await this.db
            .collection("wa_costing_method")
            .doc(waData.id)
            .update({
              wa_quantity: this.roundQty(newQuantity),
              updated_at: new Date(),
            });

          results.issuingCosting = {
            id: waData.id,
            quantity: this.roundQty(newQuantity),
            costPrice: this.roundPrice(currentCostPrice),
          };
        }
      } catch (error) {
        throw new Error(
          `Failed to update issuing plant WA costing: ${error.message}`
        );
      }

      // Process receiving plant (add to unrestricted)
      try {
        const waReceivingResponse = await this.db
          .collection("wa_costing_method")
          .where({
            material_id: materialData.id,
            plant_id: receivingPlantId,
          })
          .get();

        if (waReceivingResponse.data && waReceivingResponse.data.length > 0) {
          // Update existing WA record
          const waData = waReceivingResponse.data[0];
          const currentQuantity = this.roundQty(waData.wa_quantity || 0);
          const currentCostPrice = this.roundPrice(waData.wa_cost_price || 0);
          const currentValue = this.roundPrice(
            currentQuantity * currentCostPrice
          );

          const newQuantity = this.roundQty(
            currentQuantity + formattedQuantity
          );
          const newValue = this.roundPrice(currentValue + totalValue);
          const newCostPrice = this.roundPrice(newValue / newQuantity);

          await this.db.collection("wa_costing_method").doc(waData.id).update({
            wa_quantity: newQuantity,
            wa_cost_price: newCostPrice,
            updated_at: new Date(),
          });

          results.receivingCosting = {
            id: waData.id,
            quantity: newQuantity,
            costPrice: newCostPrice,
          };
        } else {
          // Create new WA record
          const newWaData = {
            material_id: materialData.id,
            plant_id: receivingPlantId,
            wa_quantity: formattedQuantity,
            wa_cost_price: formattedUnitPrice,
            organization_id: organizationId,
            created_at: new Date(),
            updated_at: new Date(),
          };

          const response = await this.db
            .collection("wa_costing_method")
            .add(newWaData);

          results.receivingCosting = {
            id: response.data[0].id,
            ...newWaData,
          };
        }
      } catch (error) {
        throw new Error(
          `Failed to update receiving plant WA costing: ${error.message}`
        );
      }
    } else if (materialData.material_costing_method === "First In First Out") {
      // Process issuing plant (reduce in-transit)
      try {
        const fifoIssuingResponse = await this.db
          .collection("fifo_costing_history")
          .where({
            material_id: materialData.id,
            plant_id: issuingPlantId,
          })
          .get();

        if (fifoIssuingResponse.data && fifoIssuingResponse.data.length > 0) {
          // Sort by FIFO sequence
          const fifoData = fifoIssuingResponse.data.sort(
            (a, b) => a.fifo_sequence - b.fifo_sequence
          );

          let remainingQty = formattedQuantity;

          // Process FIFO records until we've covered the full quantity
          for (const record of fifoData) {
            if (remainingQty <= 0) break;

            const availableQty = this.roundQty(
              record.fifo_available_quantity || 0
            );
            if (availableQty <= 0) continue;

            const reduceQty = this.roundQty(
              Math.min(availableQty, remainingQty)
            );
            const newAvailable = this.roundQty(availableQty - reduceQty);

            await this.db
              .collection("fifo_costing_history")
              .doc(record.id)
              .update({
                fifo_available_quantity: newAvailable,
                updated_at: new Date(),
              });

            remainingQty = this.roundQty(remainingQty - reduceQty);

            results.issuingCosting = {
              id: record.id,
              reducedQuantity: reduceQty,
              remainingQuantity: newAvailable,
              costPrice: this.roundPrice(record.fifo_cost_price),
            };
          }

          if (remainingQty > 0) {
            throw new Error(
              `Insufficient FIFO quantity at issuing plant. Remaining: ${remainingQty}`
            );
          }
        }
      } catch (error) {
        throw new Error(
          `Failed to update issuing plant FIFO costing: ${error.message}`
        );
      }

      // Process receiving plant (add new FIFO record)
      try {
        const fifoReceivingResponse = await this.db
          .collection("fifo_costing_history")
          .where({
            material_id: materialData.id,
            plant_id: receivingPlantId,
          })
          .get();

        // Determine next sequence number
        let sequenceNumber = 1;
        if (
          fifoReceivingResponse.data &&
          fifoReceivingResponse.data.length > 0
        ) {
          const existingSequences = fifoReceivingResponse.data.map((doc) =>
            Number(doc.fifo_sequence || 0)
          );
          sequenceNumber = Math.max(...existingSequences, 0) + 1;
        }

        // Create new FIFO record
        const newFifoData = {
          material_id: materialData.id,
          plant_id: receivingPlantId,
          fifo_sequence: sequenceNumber,
          fifo_cost_price: formattedUnitPrice,
          fifo_initial_quantity: formattedQuantity,
          fifo_available_quantity: formattedQuantity,
          batch_id:
            materialData.item_isbatch_managed === "1" ? materialData.id : null,
          organization_id: organizationId,
          created_at: new Date(),
          updated_at: new Date(),
        };

        const response = await this.db
          .collection("fifo_costing_history")
          .add(newFifoData);

        results.receivingCosting = {
          id: response.data[0].id,
          ...newFifoData,
        };
      } catch (error) {
        throw new Error(
          `Failed to update receiving plant FIFO costing: ${error.message}`
        );
      }
    } else if (materialData.material_costing_method === "Fixed Cost") {
      // For fixed cost, we don't need to update any costing records
      // The cost simply follows the material
      results.issuingCosting = {
        message:
          "Fixed cost method - no costing records updated for issuing plant",
      };

      results.receivingCosting = {
        message:
          "Fixed cost method - no costing records updated for receiving plant",
      };
    } else {
      throw new Error(
        `Unsupported costing method: ${materialData.material_costing_method}`
      );
    }

    return results;
  }
}

async function processFormData(db, self, organizationId) {
  const processor = new ReceivingIOFTProcessor(db);
  const closeDialog = () => {
    if (self.parentGenerateForm) {
      self.parentGenerateForm.$refs.SuPageDialogRef.hide();
      self.parentGenerateForm.refresh();
      self.hideLoading();
    }
  };

  try {
    const results = await processor.processReceivingIOFT(
      db,
      self,
      organizationId
    );
    closeDialog();
    console.log("IOFT receipt processed:", results);
    return results;
  } catch (error) {
    console.error("Error processing IOFT receipt:", error.message);
    throw error; // Error already displayed in processReceivingIOFT
  }
}

const self = this;
this.showLoading();

let organizationId = this.getVarGlobal("deptParentId");
if (organizationId === "0") {
  organizationId = this.getVarSystem("deptIds").split(",")[0];
}
console.log("organization id", organizationId);
if (organizationId === "0") {
  organizationId = this.getVarSystem("deptIds").split(",")[0];
}

processFormData(db, self, organizationId)
  .then((results) => console.log("Success:", results))
  .catch((error) => console.error("Error:", error.message));
