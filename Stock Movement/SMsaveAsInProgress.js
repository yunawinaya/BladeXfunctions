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

  async processStockAdjustment(db, self, organizationId) {
    const errors = [];
    const allData = self.getValues();

    // Step 1: Validate top-level required fields
    const requiredTopLevelFields = [
      "issuing_operation_faci",
      "receiving_operation_faci",
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

    const stockMovementId = allData.id;
    const stockMovementIssuingPlantId = allData.issuing_operation_faci;
    const stockMovementReceivingPlantId = allData.receiving_operation_faci;
    const stockMovementNumber = allData.stock_movement_no;
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
                stockMovementId,
                processedItems,
                stockMovementIssuingPlantId,
                stockMovementReceivingPlantId,
                stockMovementNumber,
                allData,
                self,
                organizationId
              );
              resolve({
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
          stockMovementIssuingPlantId,
          stockMovementReceivingPlantId,
          stockMovementNumber,
          allData,
          self,
          organizationId
        )
          .then((updateResults) => {
            resolve({
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
      const requiredFields = ["item_selection", "total_quantity"];
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
      } catch (error) {
        errors.push(
          `Failed to fetch material data for item ${stockItem.item_selection}: ${error.message}`
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
        const balanceRequiredFields = ["material_id"];
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

          // Standardize batch management check
          const isBatchManaged =
            materialData.item_batch_management == "1" ||
            materialData.item_isbatch_managed == "1";
          const collectionName = isBatchManaged
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
        } catch (error) {
          errors.push(
            `Failed to validate balance for item ${stockItem.item_selection}: ${error.message}`
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
        total_quantity: stockItem.total_quantity,
      };

      const relatedBalances = allData.balance_index
        .filter((balance) => balance.material_id === stockItem.item_selection)
        .map((balance) => ({
          material_id: balance.material_id,
          balance_id: balance.balance_id,
          batch_id: balance.batch_id,
          category: balance.category,
          location_id: balance.location_id,
          sm_quantity: balance.sm_quantity,
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
    stockMovementId,
    processedItems,
    stockMovementIssuingPlantId,
    stockMovementReceivingPlantId,
    stockMovementNumber,
    allData,
    self,
    organizationId
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
            balance.sm_quantity,
            balance.category
          );
          results.balanceUpdates.push({ issuing: issuingBalanceUpdate });
        } catch (err) {
          errors.push(
            `Failed to update issuing balance for item ${balance.material_id}: ${err.message}`
          );
          continue;
        }

        try {
          const inventoryMovement = await this.recordInventoryMovement(
            balance.material_id,
            balance.sm_quantity,
            balance.category,
            balance.location_id,
            stockMovementIssuingPlantId,
            stockMovementReceivingPlantId,
            stockMovementNumber,
            balance.batch_id,
            organizationId
          );
          results.inventoryMovements.push(inventoryMovement);
        } catch (err) {
          errors.push(
            `Failed to record inventory movement for item ${balance.material_id}: ${err.message}`
          );
          continue;
        }
      }
    }

    try {
      const issuingStockMovementResponse = await this.db
        .collection("stock_movement")
        .where({ id: stockMovementId })
        .get();
      const issuingStockMovement = issuingStockMovementResponse.data[0];

      if (issuingStockMovement) {
        const updateData = {
          stock_movement_status: "In Progress",
          update_time: new Date().toISOString(),
        };

        console.log("Update data:", updateData);

        await this.db
          .collection("stock_movement")
          .doc(issuingStockMovement.id)
          .update(updateData);

        console.log("Update operation completed");

        await new Promise((resolve) => setTimeout(resolve, 500));

        const updatedResponse = await this.db
          .collection("stock_movement")
          .doc(issuingStockMovement.id)
          .get();

        if (!updatedResponse.data || !Array.isArray(updatedResponse.data)) {
          console.log("Updated document response format:", updatedResponse);

          results.stockMovementUpdates.issuing =
            updatedResponse.data || updatedResponse;
        } else {
          results.stockMovementUpdates.issuing = updatedResponse.data[0];
        }

        // Verify the update went through
        console.log(
          "Updated document data:",
          results.stockMovementUpdates.issuing
        );
      } else {
        errors.push(
          `Issuing stock movement not found for stock_movement_no: ${stockMovementNumber}`
        );
      }
    } catch (err) {
      console.error("Detailed error:", err);
      errors.push(`Failed to update issuing stock movement: ${err.message}`);
    }

    if (results.stockMovementUpdates.issuing) {
      try {
        const receivingIOFT = await this.createReceivingIOFT(
          stockMovementReceivingPlantId,
          allData,
          stockMovementId,
          self,
          organizationId
        );
        results.receivingIOFT = receivingIOFT.data[0];
      } catch (err) {
        errors.push(`Failed to create receiving IOFT: ${err.message}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(errors.join("; "));
    }

    return results;
  }

  async updateIssuingBalance(balanceId, materialId, smQuantity, category) {
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

    // Standardize batch management check
    const isBatchManaged =
      materialData.item_batch_management == "1" ||
      materialData.item_isbatch_managed == "1";
    const collectionName = isBatchManaged
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

    const formattedSmQuantity = this.roundQty(smQuantity);

    const categoryField = this.categoryMap[category];

    const updateData = {
      [categoryField]: this.roundQty(
        (balanceData[categoryField] || 0) - formattedSmQuantity
      ),
      intransit_qty: this.roundQty(
        (balanceData.intransit_qty || 0) + formattedSmQuantity
      ),
      balance_quantity: this.roundQty(balanceData.balance_quantity),
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

  async recordInventoryMovement(
    materialId,
    smQuantity,
    category,
    locationId,
    stockMovementIssuingPlantId,
    stockMovementReceivingPlantId,
    stockMovementNumber,
    batchId,
    organizationId
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

    // Standardize batch management check
    const isBatchManaged =
      materialData.item_batch_management == "1" ||
      materialData.item_isbatch_managed == "1";

    let unitPrice;

    if (materialData.material_costing_method === "First In First Out") {
      // Get unit price from latest FIFO sequence
      const fifoCostPrice = await this.getLatestFIFOCostPrice(
        materialData,
        batchId
      );
      unitPrice = fifoCostPrice;
    } else if (materialData.material_costing_method === "Weighted Average") {
      // Get unit price from WA cost price
      const waCostPrice = await this.getWeightedAverageCostPrice(
        materialData,
        batchId
      );
      unitPrice = waCostPrice;
    } else if (materialData.material_costing_method === "Fixed Cost") {
      // Get unit price from Fixed Cost
      const fixedCostPrice = await this.getFixedCostPrice(materialData.id);
      unitPrice = fixedCostPrice;
    } else {
      return Promise.resolve();
    }

    const formattedSmQuantity = this.roundQty(smQuantity);
    const formattedUnitPrice = this.roundPrice(unitPrice || 0);

    const outMovement = {
      transaction_type: "SM",
      trx_no: stockMovementNumber,
      movement: "OUT",
      inventory_category: category,
      parent_trx_no: null,
      unit_price: formattedUnitPrice,
      total_price: this.roundPrice(formattedUnitPrice * formattedSmQuantity),
      quantity: formattedSmQuantity,
      item_id: materialId,
      uom_id: materialData.based_uom,
      base_qty: formattedSmQuantity,
      base_uom_id: materialData.based_uom,
      bin_location_id: locationId,
      batch_number_id: isBatchManaged ? batchId : null,
      costing_method_id: materialData.material_costing_method,
      organization_id: organizationId,
      plant_id: stockMovementIssuingPlantId,
      created_at: new Date(),
    };

    const inMovement = {
      transaction_type: "SM",
      trx_no: stockMovementNumber,
      parent_trx_no: null,
      movement: "IN",
      unit_price: formattedUnitPrice,
      total_price: this.roundPrice(formattedUnitPrice * formattedSmQuantity),
      quantity: formattedSmQuantity,
      item_id: materialId,
      inventory_category: "In Transit",
      uom_id: materialData.based_uom,
      base_qty: formattedSmQuantity,
      base_uom_id: materialData.based_uom,
      bin_location_id: locationId,
      batch_number_id: isBatchManaged ? batchId : null,
      costing_method_id: materialData.material_costing_method,
      created_at: new Date(),
      plant_id: stockMovementIssuingPlantId,
      organization_id: organizationId,
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

  async createReceivingIOFT(
    receivingPlantId,
    allData,
    stockMovementId,
    self,
    organizationId
  ) {
    try {
      // Store material data, unit prices, and balance info for all items
      const materialsMap = {};
      const unitPricesMap = {};
      const balanceInfoMap = {};

      // Process each stock movement item to get material data and calculate unit prices
      for (const item of allData.stock_movement) {
        const materialResponse = await this.db
          .collection("Item")
          .where({ id: item.item_selection })
          .get();

        if (!materialResponse.data || materialResponse.data.length === 0) {
          throw new Error(`Material with ID ${item.item_selection} not found`);
        }

        const material = materialResponse.data[0];
        materialsMap[item.item_selection] = material;

        // Find related balances for this item
        const relatedBalances = allData.balance_index.filter(
          (balance) => balance.material_id === item.item_selection
        );

        // Get first balance to use for this specific item
        const firstBalance =
          relatedBalances.length > 0 ? relatedBalances[0] : null;

        // Store balance info for this specific item
        balanceInfoMap[item.item_selection] = {
          category: firstBalance?.category || "Unrestricted",
          batch_id: firstBalance?.batch_id || null,
        };

        // Calculate unit price based on costing method
        let unitPrice = 0;
        if (material.material_costing_method === "First In First Out") {
          unitPrice = await this.getLatestFIFOCostPrice(
            material,
            balanceInfoMap[item.item_selection].batch_id
          );
        } else if (material.material_costing_method === "Weighted Average") {
          unitPrice = await this.getWeightedAverageCostPrice(
            material,
            balanceInfoMap[item.item_selection].batch_id
          );
        } else if (material.material_costing_method === "Fixed Cost") {
          unitPrice = await this.getFixedCostPrice(material.id);
        }

        unitPricesMap[item.item_selection] = this.roundPrice(unitPrice || 0);
      }

      console.log("All Data", allData);
      console.log("Balance Info Map:", balanceInfoMap);

      const movementTypeReceiving =
        "Inter Operation Facility Transfer (Receiving)";

      const resType = await db
        .collection("blade_dict")
        .where({ dict_key: movementTypeReceiving })
        .get();
      const movementTypeId = resType.data[0].id;

      const resBinLocation = await db
        .collection("bin_location")
        .where({
          plant_id: receivingPlantId,
        })
        .get();

      let binLocationId;
      if (resBinLocation.data && resBinLocation.data.length > 0) {
        binLocationId = resBinLocation.data[0].id;
      } else {
        console.warn(
          "No default bin location found for plant:",
          receivingPlantId
        );
      }

      const prefixResponse = await this.db
        .collection("prefix_configuration")
        .where({
          document_types: "Stock Movement",
          movement_type: movementTypeReceiving,
          is_deleted: 0,
          organization_id: organizationId,
          is_active: 1,
        })
        .get();

      if (!prefixResponse.data || prefixResponse.data.length === 0) {
        throw new Error("No prefix configuration found");
      }

      const prefixData = prefixResponse.data[0];
      const now = new Date();
      let newPrefix = "";
      let prefixToShow;
      let runningNumber = prefixData.running_number;
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
        try {
          const existingDoc = await this.db
            .collection("stock_movement")
            .where({
              stock_movement_no: generatedPrefix,
              organization_id: organizationId,
            })
            .get();
          return !existingDoc.data || !existingDoc.data.length;
        } catch (error) {
          console.error("Error checking uniqueness:", error);
          return false; // Assume not unique on error to be safe
        }
      };

      const findUniquePrefix = async (runningNumber, organizationId) => {
        while (!isUnique && attempts < maxAttempts) {
          attempts++;
          prefixToShow = generatePrefix(runningNumber);
          isUnique = await checkUniqueness(prefixToShow, organizationId);
          if (!isUnique) {
            runningNumber++;
          }
        }

        if (!isUnique) {
          throw new Error(
            "Could not generate a unique Stock Movement number after maximum attempts"
          );
        } else {
          newPrefix = prefixToShow;
          await this.db
            .collection("prefix_configuration")
            .where({
              document_types: "Stock Movement",
              is_deleted: 0,
              organization_id: organizationId,
              movement_type: movementTypeReceiving,
            })
            .update({
              running_number: parseInt(runningNumber) + 1,
              has_record: 1,
            });
        }
      };

      await findUniquePrefix(runningNumber, organizationId);

      const receivingIOFT = {
        stock_movement_status: "Created",
        stock_movement_no: newPrefix,
        movement_type: movementTypeReceiving,
        movement_type_id: movementTypeId,
        issuing_operation_faci: receivingPlantId,
        movement_id: stockMovementId,
        reference_documents: allData.reference_documents,
        stock_movement: allData.stock_movement.map((item) => {
          const material = materialsMap[item.item_selection];
          if (!material) {
            throw new Error(
              `Material with ID ${item.item_selection} not found`
            );
          }

          // Use item-specific balance info
          const balanceInfo = balanceInfoMap[item.item_selection];

          return {
            item_selection: item.item_selection,
            total_quantity: item.total_quantity,
            received_quantity: item.total_quantity,
            received_quantity_uom: material.based_uom,
            unit_price: unitPricesMap[item.item_selection] || 0,
            location_id: binLocationId,
            category: balanceInfo.category,
            temp_qty_data: item.temp_qty_data,
          };
        }),
        issue_date: allData.issue_date,
        issued_by: allData.issued_by,
        remarks: allData.remarks,
        organization_id: organizationId,
        posted_status: "",
      };

      const result = await this.db
        .collection("stock_movement")
        .add(receivingIOFT);
      console.log("Created receiving IOFT:", result);
      return result;
    } catch (error) {
      console.error("Error creating receiving IOFT:", error);
      throw new Error(`Failed to create receiving IOFT: ${error.message}`);
    }
  }
}

async function processFormData(db, self, organizationId) {
  const adjuster = new StockAdjuster(db);
  const closeDialog = () => {
    if (self.parentGenerateForm) {
      self.parentGenerateForm.$refs.SuPageDialogRef.hide();
      self.parentGenerateForm.refresh();
      self.hideLoading();
    }
  };

  try {
    const results = await adjuster.processStockAdjustment(
      db,
      self,
      organizationId
    );
    closeDialog();
    console.log("Stock movement processed:", results);
    return results;
  } catch (error) {
    console.error("Error processing stock adjustment:", error.message);
    throw error; // Error already displayed in processStockAdjustment
  }
}

const self = this;
this.showLoading();
let organizationId = this.getVarGlobal("deptParentId");
console.log("organization id", organizationId);
if (organizationId === "0") {
  organizationId = this.getVarSystem("deptIds").split(",")[0];
}

processFormData(db, self, organizationId)
  .then((results) => console.log("Success:", results))
  .catch((error) => console.error("Error:", error.message));
