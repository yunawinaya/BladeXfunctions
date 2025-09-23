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

      console.log("receivingIOFT.balance_index:", receivingIOFT.balance_index);

      for (const item of receivingIOFT.stock_movement) {
        console.log("Processing stock_movement item:", item);

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
          console.log("Material data:", materialData);

          // Check if the material has sufficient in-transit quantity
          const isBatchManaged =
            materialData.item_batch_management == "1" ||
            materialData.item_isbatch_managed == "1";

          const isSerializedItem = materialData.serial_number_management === 1;

          const collectionName = isBatchManaged
            ? "item_batch_balance"
            : "item_balance";

          // Handle serialized vs non-serialized items differently
          let validBalances = [];

          if (isSerializedItem) {
            // For serialized items, validate using item_serial_balance and balance_index
            console.log(`Processing serialized item: ${item.item_selection}`);
            console.log(
              `Available balance_index:`,
              receivingIOFT.balance_index
            );

            // Get balance_index for this item from receiving IOFT
            const itemBalanceIndex = receivingIOFT.balance_index
              ? receivingIOFT.balance_index.filter(
                  (balance) => balance.material_id === item.item_selection
                )
              : [];

            console.log(
              `Filtered balance_index for item ${item.item_selection}:`,
              itemBalanceIndex
            );

            if (itemBalanceIndex.length === 0) {
              errors.push(
                `No serial balance index found for serialized item ${item.item_selection}`
              );
              continue;
            }

            // Validate each serial number has sufficient in-transit quantity
            for (const balanceIndex of itemBalanceIndex) {
              if (!balanceIndex.serial_number) {
                errors.push(
                  `Serial number is required for serialized item ${item.item_selection}`
                );
                continue;
              }

              const serialBalanceParams = {
                material_id: item.item_selection,
                serial_number: balanceIndex.serial_number,
                plant_id: issuingIOFT.issuing_operation_faci,
                organization_id: organizationId,
              };

              if (balanceIndex.batch_id) {
                serialBalanceParams.batch_id = balanceIndex.batch_id;
              }
              if (balanceIndex.location_id) {
                serialBalanceParams.location_id = balanceIndex.location_id;
              }

              const serialBalanceResponse = await this.db
                .collection("item_serial_balance")
                .where(serialBalanceParams)
                .get();

              if (
                !serialBalanceResponse.data ||
                serialBalanceResponse.data.length === 0
              ) {
                errors.push(
                  `No serial balance found for serial ${balanceIndex.serial_number} of item ${item.item_selection}`
                );
                continue;
              }

              const serialBalance = serialBalanceResponse.data[0];
              const intransitQty = serialBalance.intransit_qty || 0;

              if (intransitQty < (balanceIndex.sm_quantity || 1)) {
                errors.push(
                  `Insufficient intransit quantity for serial ${
                    balanceIndex.serial_number
                  } of item ${
                    item.item_selection
                  }. Available: ${intransitQty}, Requested: ${
                    balanceIndex.sm_quantity || 1
                  }`
                );
                continue;
              }

              // Add to valid balances with additional serial info
              validBalances.push({
                ...serialBalance,
                balance_index: balanceIndex,
                is_serialized: true,
              });
            }
          } else {
            // For non-serialized items, use existing logic
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
            validBalances = balanceResponse.data.filter(
              (balance) => (balance.intransit_qty || 0) > 0
            );

            if (validBalances.length === 0) {
              errors.push(
                `No in-transit quantity available for material ${item.item_selection}`
              );
              continue;
            }
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

      // Check if this is a serialized item
      const isSerializedItem = materialData.serial_number_management === 1;

      if (isSerializedItem) {
        // For serialized items, group balances by location, batch, and category before processing
        console.log(
          `Grouping serialized balances for item: ${item.item_selection}`
        );

        const groupedBalances = new Map();

        for (const balance of balances) {
          console.log("Processing balance for grouping:", balance);

          if (!balance.balance_index) {
            console.error("Balance missing balance_index:", balance);
            errors.push(
              `Balance missing balance_index data for item ${item.item_selection}`
            );
            continue;
          }

          const groupKey = `${balance.balance_index.location_id || "null"}_${
            balance.balance_index.batch_id || "null"
          }_${balance.balance_index.category || "Unrestricted"}`;

          console.log("Generated groupKey:", groupKey);

          if (groupedBalances.has(groupKey)) {
            const existingGroup = groupedBalances.get(groupKey);
            existingGroup.serialBalances.push(balance);
            existingGroup.totalQty += Number(
              balance.balance_index.sm_quantity || 1
            );
          } else {
            groupedBalances.set(groupKey, {
              serialBalances: [balance],
              totalQty: Number(balance.balance_index.sm_quantity || 1),
              location_id: balance.balance_index.location_id,
              batch_id: balance.balance_index.batch_id,
              category: balance.balance_index.category || "Unrestricted",
              representativeBalance: balance,
            });
          }
        }

        console.log(
          `Grouped ${balances.length} serial balances into ${groupedBalances.size} groups for item ${item.item_selection}`
        );

        // Process each group
        for (const [groupKey, group] of groupedBalances.entries()) {
          console.log(
            `Processing group: ${groupKey} with ${group.serialBalances.length} serials, total qty: ${group.totalQty}`
          );

          let batchId = "";

          // Handle batch creation if needed
          if (materialData.item_batch_management === 1) {
            const batchData = {
              batch_number: item.batch_id,
              material_id: item.item_selection,
              initial_quantity: this.roundQty(group.totalQty),
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

          try {
            // 1. Update issuing plant balances for all serials in this group
            for (const balance of group.serialBalances) {
              const quantityFromThisSerial = Number(
                balance.balance_index.sm_quantity || 1
              );

              const issuingBalanceUpdate = await this.updateIssuingBalance(
                balance.id,
                materialData.id,
                quantityFromThisSerial,
                balance
              );
              results.balanceUpdates.issuing.push(issuingBalanceUpdate);
            }

            // 2. Create or update receiving plant balances for all serials in this group
            for (const balance of group.serialBalances) {
              const quantityFromThisSerial = Number(
                balance.balance_index.sm_quantity || 1
              );

              const receivingBalanceUpdate = await this.updateReceivingBalance(
                materialData.id,
                receivingIOFT.issuing_operation_faci,
                group.location_id || item.location_id,
                quantityFromThisSerial,
                group.category,
                item.unit_price,
                organizationId,
                batchId,
                balance.balance_index.serial_number
              );
              results.balanceUpdates.receiving.push(receivingBalanceUpdate);
            }

            // 3. Create ONE grouped inventory movement for this group
            const groupedInventoryMovements =
              await this.recordGroupedInventoryMovements(
                materialData.id,
                group.totalQty,
                "In Transit", // Source category at issuing plant
                group.category, // Target category at receiving plant
                group.location_id || item.location_id,
                issuingIOFT.stock_movement_no,
                receivingIOFT.stock_movement_no,
                issuingIOFT.issuing_operation_faci,
                receivingIOFT.issuing_operation_faci,
                item.unit_price,
                item.received_quantity_uom,
                materialData,
                organizationId,
                batchId,
                group.serialBalances
              );

            results.inventoryMovements.issuing.push(
              groupedInventoryMovements.issuingMovement
            );
            results.inventoryMovements.receiving.push(
              groupedInventoryMovements.receivingMovement
            );

            // 4. Update costing records (use representative balance for costing)
            const costingUpdates = await this.updateCosting(
              materialData,
              group.totalQty,
              issuingIOFT.issuing_operation_faci,
              receivingIOFT.issuing_operation_faci,
              item.unit_price,
              organizationId
            );
            results.costingUpdates.issuing.push(costingUpdates.issuingCosting);
            results.costingUpdates.receiving.push(
              costingUpdates.receivingCosting
            );
          } catch (error) {
            errors.push(
              `Error processing serialized group ${groupKey} for item ${materialData.id}: ${error.message}`
            );
          }
        }
      } else {
        // Process non-serialized items with existing logic
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
            // Check if this is a serialized item
            const isSerializedItem =
              materialData.serial_number_management === 1;

            // 1. Update issuing plant balance (decrease in-transit)
            const issuingBalanceUpdate = await this.updateIssuingBalance(
              balance.id,
              materialData.id,
              quantityFromThisBalance,
              balance.is_serialized ? balance : null
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
              batchId,
              isSerializedItem && balance.balance_index
                ? balance.balance_index.serial_number
                : null
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
              batchId,
              isSerializedItem && balance.balance_index
                ? balance.balance_index.serial_number
                : null
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

  async updateIssuingBalance(
    balanceId,
    materialId,
    quantity,
    balanceInfo = null
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

    const isSerializedItem = materialData.serial_number_management === 1;
    const formattedQuantity = this.roundQty(quantity);

    // Handle serialized items differently
    if (isSerializedItem && balanceInfo && balanceInfo.is_serialized) {
      // For serialized items, update item_serial_balance
      const serialBalance = balanceInfo;
      const currentInTransit = this.roundQty(serialBalance.intransit_qty || 0);

      if (currentInTransit < formattedQuantity) {
        throw new Error(
          `Insufficient in-transit quantity for serial ${serialBalance.balance_index.serial_number}. Available: ${currentInTransit}, Requested: ${formattedQuantity}`
        );
      }

      const updateData = {
        intransit_qty: this.roundQty(currentInTransit - formattedQuantity),
        balance_quantity: this.roundQty(
          (serialBalance.balance_quantity || 0) - formattedQuantity
        ),
        update_time: new Date().toISOString(),
      };

      try {
        await this.db
          .collection("item_serial_balance")
          .doc(serialBalance.id)
          .update(updateData);
      } catch (err) {
        throw new Error(
          `Failed to update issuing serial balance: ${err.message}`
        );
      }

      return {
        balanceId: serialBalance.id,
        materialId,
        serialNumber: serialBalance.balance_index.serial_number,
        quantityReduced: formattedQuantity,
        ...updateData,
      };
    } else {
      // For non-serialized items, use existing logic
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

      // ✅ CRITICAL FIX: For batched items, also update item_balance (aggregated across all batches)
      if (isBatchManaged && collectionName === "item_batch_balance") {
        try {
          const generalItemBalanceParams = {
            material_id: materialId,
            location_id: balanceData.location_id,
            plant_id: balanceData.plant_id,
            organization_id: balanceData.organization_id,
          };

          // Don't include batch_id in item_balance query (aggregated balance across all batches)
          const generalBalanceQuery = await this.db
            .collection("item_balance")
            .where(generalItemBalanceParams)
            .get();

          if (generalBalanceQuery.data && generalBalanceQuery.data.length > 0) {
            // Update existing item_balance record
            const generalBalance = generalBalanceQuery.data[0];

            const currentGeneralIntransitQty = parseFloat(
              generalBalance.intransit_qty || 0
            );
            const currentGeneralBalanceQty = parseFloat(
              generalBalance.balance_quantity || 0
            );

            const generalUpdateData = {
              intransit_qty: this.roundQty(
                currentGeneralIntransitQty - formattedQuantity
              ),
              balance_quantity: this.roundQty(
                currentGeneralBalanceQty - formattedQuantity
              ),
              update_time: new Date().toISOString(),
            };

            await this.db
              .collection("item_balance")
              .doc(generalBalance.id)
              .update(generalUpdateData);

            console.log(
              `Updated aggregated item_balance for issuing balance (IOFT), material ${materialId}`
            );
          } else {
            // This case is rare - item_balance should exist if item_batch_balance exists
            console.warn(
              `No existing item_balance found for batched material ${materialId} during IOFT issuing balance update`
            );
          }
        } catch (error) {
          console.error(
            `Error updating aggregated item_balance for IOFT issuing balance, material ${materialId}:`,
            error
          );
          // Don't throw - let the main process continue
        }
      }

      return {
        balanceId,
        materialId,
        quantityReduced: formattedQuantity,
        ...updateData,
      };
    }
  }

  async updateReceivingBalance(
    materialId,
    plantId,
    locationId,
    quantity,
    category = "Unrestricted",
    unitPrice,
    organizationId,
    batchId,
    serialNumber = null
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

    // Determine the collection and logic based on whether the material is serialized
    const isSerializedItem = materialData.serial_number_management === 1;
    const isBatchManaged =
      materialData.item_batch_management == "1" ||
      materialData.item_isbatch_managed == "1";

    const categoryField = this.categoryMap[category];
    if (!categoryField) {
      throw new Error(`Invalid category: ${category}`);
    }

    const formattedQuantity = this.roundQty(quantity);

    // Handle serialized items differently
    if (isSerializedItem && serialNumber) {
      // For serialized items, update or create item_serial_balance
      const serialBalanceQuery = {
        material_id: materialId,
        serial_number: serialNumber,
        plant_id: plantId,
        organization_id: organizationId,
      };

      if (locationId) {
        serialBalanceQuery.location_id = locationId;
      }
      if (batchId) {
        serialBalanceQuery.batch_id = batchId;
      }

      let serialBalanceData;
      try {
        const serialBalanceResponse = await this.db
          .collection("item_serial_balance")
          .where(serialBalanceQuery)
          .get();

        if (
          serialBalanceResponse.data &&
          serialBalanceResponse.data.length > 0
        ) {
          serialBalanceData = serialBalanceResponse.data[0];
        }
      } catch (err) {
        throw new Error(
          `Failed to fetch receiving serial balance: ${err.message}`
        );
      }

      // Update or create serial balance
      if (serialBalanceData) {
        const currentCategoryQty = this.roundQty(
          serialBalanceData[categoryField] || 0
        );

        const updateData = {
          [categoryField]: this.roundQty(
            currentCategoryQty + formattedQuantity
          ),
          balance_quantity: this.roundQty(
            (serialBalanceData.balance_quantity || 0) + formattedQuantity
          ),
          update_time: new Date().toISOString(),
        };

        try {
          await this.db
            .collection("item_serial_balance")
            .doc(serialBalanceData.id)
            .update(updateData);

          return {
            balanceId: serialBalanceData.id,
            materialId,
            serialNumber,
            quantityAdded: formattedQuantity,
            ...updateData,
          };
        } catch (err) {
          throw new Error(
            `Failed to update receiving serial balance: ${err.message}`
          );
        }
      } else {
        // Create new serial balance
        const newSerialBalanceData = {
          material_id: materialId,
          serial_number: serialNumber,
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
        newSerialBalanceData[categoryField] = formattedQuantity;

        try {
          const response = await this.db
            .collection("item_serial_balance")
            .add(newSerialBalanceData);

          return {
            balanceId: response.data[0].id,
            materialId,
            serialNumber,
            quantityAdded: formattedQuantity,
            ...newSerialBalanceData,
          };
        } catch (err) {
          throw new Error(
            `Failed to create receiving serial balance: ${err.message}`
          );
        }
      }
    } else {
      // For non-serialized items, use existing logic
      const collectionName = isBatchManaged
        ? "item_batch_balance"
        : "item_balance";

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
        const currentCategoryQty = this.roundQty(
          balanceData[categoryField] || 0
        );
        const currentBalanceQty = this.roundQty(
          balanceData.balance_quantity || 0
        );

        const updateData = {
          [categoryField]: this.roundQty(
            currentCategoryQty + formattedQuantity
          ),
          balance_quantity: this.roundQty(
            currentBalanceQty + formattedQuantity
          ),
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

      // ✅ CRITICAL FIX: For batched items, also update item_balance (aggregated across all batches)
      if (isBatchManaged && collectionName === "item_batch_balance") {
        try {
          const generalItemBalanceParams = {
            material_id: materialId,
            location_id: locationId,
            plant_id: plantId,
            organization_id: organizationId,
          };

          // Don't include batch_id in item_balance query (aggregated balance across all batches)
          const generalBalanceQuery = await this.db
            .collection("item_balance")
            .where(generalItemBalanceParams)
            .get();

          if (generalBalanceQuery.data && generalBalanceQuery.data.length > 0) {
            // Update existing item_balance record
            const generalBalance = generalBalanceQuery.data[0];

            const currentGeneralBalanceQty = parseFloat(
              generalBalance.balance_quantity || 0
            );
            const currentGeneralCategoryQty = parseFloat(
              generalBalance[categoryField] || 0
            );

            const generalUpdateData = {
              balance_quantity: this.roundQty(
                currentGeneralBalanceQty + formattedQuantity
              ),
              [categoryField]: this.roundQty(
                currentGeneralCategoryQty + formattedQuantity
              ),
              update_time: new Date().toISOString(),
            };

            await this.db
              .collection("item_balance")
              .doc(generalBalance.id)
              .update(generalUpdateData);

            console.log(
              `Updated aggregated item_balance for receiving balance (IOFT), material ${materialId}`
            );
          } else {
            // Create new item_balance record if it doesn't exist
            const generalUpdateData = {
              material_id: materialId,
              location_id: locationId,
              plant_id: plantId,
              organization_id: organizationId,
              balance_quantity: this.roundQty(formattedQuantity),
              unrestricted_qty:
                categoryField === "unrestricted_qty"
                  ? this.roundQty(formattedQuantity)
                  : 0,
              qualityinsp_qty:
                categoryField === "qualityinsp_qty"
                  ? this.roundQty(formattedQuantity)
                  : 0,
              block_qty:
                categoryField === "block_qty"
                  ? this.roundQty(formattedQuantity)
                  : 0,
              reserved_qty:
                categoryField === "reserved_qty"
                  ? this.roundQty(formattedQuantity)
                  : 0,
              intransit_qty:
                categoryField === "intransit_qty"
                  ? this.roundQty(formattedQuantity)
                  : 0,
              create_time: new Date().toISOString(),
              update_time: new Date().toISOString(),
              is_deleted: 0,
            };

            await this.db.collection("item_balance").add(generalUpdateData);

            console.log(
              `Created new aggregated item_balance for receiving balance (IOFT), material ${materialId}`
            );
          }
        } catch (error) {
          console.error(
            `Error updating aggregated item_balance for receiving balance (IOFT), material ${materialId}:`,
            error
          );
          // Don't throw - let the main process continue
        }
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
    batchId,
    serialNumber = null
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

      await this.db.collection("inventory_movement").add(receivingMovement);

      // For serialized items, create serial movement records
      const isSerializedItem = materialData.serial_number_management === 1;
      if (isSerializedItem && serialNumber) {
        console.log(
          `Creating serial movement records for serial: ${serialNumber}`
        );

        // Wait a bit for inventory movements to be created
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Create serial movement for issuing movements
        for (let i = 0; i < issuingResults.length; i++) {
          // Query to get the actual issuing movement ID
          const issuingMovementQuery = await this.db
            .collection("inventory_movement")
            .where({
              transaction_type: "SM",
              trx_no: issuingStockMovementNo,
              movement: "OUT",
              inventory_category: sourceCategory,
              item_id: issuingMovementData[i].item_id,
              bin_location_id: issuingMovementData[i].bin_location_id,
              base_qty: issuingMovementData[i].base_qty,
              plant_id: issuingPlantId,
              organization_id: organizationId,
            })
            .get();

          if (
            issuingMovementQuery.data &&
            issuingMovementQuery.data.length > 0
          ) {
            const issuingMovementId = issuingMovementQuery.data[0].id;
            await this.createSerialMovementRecord(
              issuingMovementId,
              serialNumber,
              batchId,
              issuingMovementData[i].quantity,
              issuingMovementData[i].base_uom_id,
              issuingPlantId,
              organizationId
            );
          } else {
            console.error(`Failed to retrieve issuing movement ${i}`);
          }
        }

        // Query to get the actual receiving movement ID
        const receivingMovementQuery = await this.db
          .collection("inventory_movement")
          .where({
            transaction_type: "SM",
            trx_no: receivingStockMovementNo,
            movement: "IN",
            inventory_category: targetCategory,
            item_id: materialId,
            bin_location_id: locationId,
            base_qty: formattedQuantity,
            plant_id: receivingPlantId,
            organization_id: organizationId,
          })
          .get();

        if (
          receivingMovementQuery.data &&
          receivingMovementQuery.data.length > 0
        ) {
          const receivingMovementId = receivingMovementQuery.data[0].id;
          await this.createSerialMovementRecord(
            receivingMovementId,
            serialNumber,
            batchId,
            formattedQuantity,
            itemUom,
            receivingPlantId,
            organizationId
          );
        } else {
          console.error("Failed to retrieve receiving movement");
        }
      }

      // Return properly structured results with queried IDs
      const issuingMovements = [];
      for (let i = 0; i < issuingMovementData.length; i++) {
        const issuingQuery = await this.db
          .collection("inventory_movement")
          .where({
            transaction_type: "SM",
            trx_no: issuingStockMovementNo,
            movement: "OUT",
            inventory_category: sourceCategory,
            item_id: issuingMovementData[i].item_id,
            bin_location_id: issuingMovementData[i].bin_location_id,
            base_qty: issuingMovementData[i].base_qty,
            plant_id: issuingPlantId,
            organization_id: organizationId,
          })
          .get();

        issuingMovements.push({
          id:
            issuingQuery.data && issuingQuery.data.length > 0
              ? issuingQuery.data[0].id
              : null,
          ...issuingMovementData[i],
        });
      }

      const receivingQuery = await this.db
        .collection("inventory_movement")
        .where({
          transaction_type: "SM",
          trx_no: receivingStockMovementNo,
          movement: "IN",
          inventory_category: targetCategory,
          item_id: materialId,
          bin_location_id: locationId,
          base_qty: formattedQuantity,
          plant_id: receivingPlantId,
          organization_id: organizationId,
        })
        .get();

      return {
        issuingMovement: issuingMovements,
        receivingMovement: {
          id:
            receivingQuery.data && receivingQuery.data.length > 0
              ? receivingQuery.data[0].id
              : null,
          ...receivingMovement,
        },
      };
    } catch (err) {
      throw new Error(`Failed to record inventory movements: ${err.message}`);
    }
  }

  // Method to record grouped inventory movements for serialized items
  async recordGroupedInventoryMovements(
    materialId,
    totalQuantity,
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
    batchId,
    serialBalances
  ) {
    const formattedTotalQuantity = this.roundQty(totalQuantity);
    const formattedUnitPrice = this.roundPrice(unitPrice || 0);
    const totalPrice = this.roundPrice(
      formattedUnitPrice * formattedTotalQuantity
    );

    // Use the material's UOM if not specified
    const itemUom = uom || materialData.based_uom || materialData.uom_id;
    const isBatchManaged =
      materialData.item_batch_management == "1" ||
      materialData.item_isbatch_managed == "1";

    const representativeSerial = serialBalances[0];
    const issuingLocationId =
      representativeSerial?.balance_index?.location_id || locationId;
    const issuingBatchId =
      representativeSerial?.balance_index?.batch_id || batchId;

    const outMovement = {
      transaction_type: "SM",
      trx_no: issuingStockMovementNo,
      movement: "OUT",
      inventory_category: sourceCategory,
      parent_trx_no: null,
      unit_price: formattedUnitPrice,
      total_price: totalPrice,
      quantity: formattedTotalQuantity,
      item_id: materialId,
      uom_id: itemUom,
      base_qty: formattedTotalQuantity,
      base_uom_id: itemUom,
      bin_location_id: issuingLocationId,
      batch_number_id: isBatchManaged ? issuingBatchId : null,
      costing_method_id: materialData.material_costing_method,
      organization_id: organizationId,
      plant_id: issuingPlantId,
      created_at: new Date(),
    };

    // Create grouped IN movement (one record for all serials in this group)
    const inMovement = {
      transaction_type: "SM",
      trx_no: receivingStockMovementNo,
      parent_trx_no: issuingStockMovementNo || null,
      movement: "IN",
      unit_price: formattedUnitPrice,
      total_price: totalPrice,
      quantity: formattedTotalQuantity,
      item_id: materialId,
      inventory_category: targetCategory,
      uom_id: itemUom,
      base_qty: formattedTotalQuantity,
      base_uom_id: itemUom,
      bin_location_id: locationId,
      batch_number_id: isBatchManaged ? batchId : null,
      costing_method_id: materialData.material_costing_method,
      created_at: new Date(),
      plant_id: receivingPlantId,
      organization_id: organizationId,
    };

    try {
      console.log(
        `✅ Created grouped inventory movements for ${serialBalances.length} serial numbers`
      );

      // Wait for inventory movement records to be created
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Query to get the actual OUT movement ID
      const outMovementQuery = await this.db
        .collection("inventory_movement")
        .where({
          transaction_type: "SM",
          trx_no: issuingStockMovementNo,
          movement: "OUT",
          inventory_category: sourceCategory,
          item_id: materialId,
          bin_location_id: issuingLocationId,
          base_qty: formattedTotalQuantity,
          plant_id: issuingPlantId,
          organization_id: organizationId,
        })
        .get();

      const outMovementId =
        outMovementQuery.data && outMovementQuery.data.length > 0
          ? outMovementQuery.data[0].id
          : null;

      // Query to get the actual IN movement ID
      const inMovementQuery = await this.db
        .collection("inventory_movement")
        .where({
          transaction_type: "SM",
          trx_no: receivingStockMovementNo,
          movement: "IN",
          inventory_category: targetCategory,
          item_id: materialId,
          bin_location_id: locationId,
          base_qty: formattedTotalQuantity,
          plant_id: receivingPlantId,
          organization_id: organizationId,
        })
        .get();

      const inMovementId =
        inMovementQuery.data && inMovementQuery.data.length > 0
          ? inMovementQuery.data[0].id
          : null;

      // Create serial movement records for each serial number in the group
      const serialPromises = [];

      for (const serialBalance of serialBalances) {
        if (
          serialBalance.balance_index &&
          serialBalance.balance_index.serial_number
        ) {
          const serialQuantity = this.roundQty(
            serialBalance.balance_index.sm_quantity || 1
          );

          // Create serial movement for OUT
          if (outMovementId) {
            serialPromises.push(
              this.createSerialMovementRecord(
                outMovementId,
                serialBalance.balance_index.serial_number,
                serialBalance.balance_index.batch_id || batchId,
                serialQuantity,
                itemUom,
                issuingPlantId,
                organizationId
              )
            );
          }

          // Create serial movement for IN
          if (inMovementId) {
            serialPromises.push(
              this.createSerialMovementRecord(
                inMovementId,
                serialBalance.balance_index.serial_number,
                serialBalance.balance_index.batch_id || batchId,
                serialQuantity,
                itemUom,
                receivingPlantId,
                organizationId
              )
            );
          }
        }
      }

      // Wait for all serial movement records to be created
      await Promise.all(serialPromises);

      console.log(
        `✅ Created ${serialPromises.length} serial movement records for group`
      );

      return {
        issuingMovement: {
          id: outMovementId,
          ...outMovement,
        },
        receivingMovement: {
          id: inMovementId,
          ...inMovement,
        },
        serialMovements: serialPromises.length,
        groupedSerials: serialBalances
          .map((b) => b.balance_index?.serial_number)
          .filter(Boolean),
      };
    } catch (err) {
      throw new Error(
        `Failed to create grouped inventory movement: ${err.message}`
      );
    }
  }

  // Add method to create serial movement record
  async createSerialMovementRecord(
    inventoryMovementId,
    serialNumber,
    batchId,
    baseQty,
    baseUOM,
    plantId,
    organizationId
  ) {
    const invSerialMovementRecord = {
      inventory_movement_id: inventoryMovementId,
      serial_number: serialNumber,
      batch_id: batchId || null,
      base_qty: this.roundQty(baseQty),
      base_uom: baseUOM,
      plant_id: plantId,
      organization_id: organizationId,
    };

    await this.db
      .collection("inv_serial_movement")
      .add(invSerialMovementRecord);
    console.log(`Created inv_serial_movement for serial: ${serialNumber}`);
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
