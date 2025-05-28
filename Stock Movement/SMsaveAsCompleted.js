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

  // Helper functions for consistent decimal formatting
  roundQty(value) {
    return parseFloat(parseFloat(value || 0).toFixed(3));
  }

  roundPrice(value) {
    return parseFloat(parseFloat(value || 0).toFixed(4));
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

  async updateProductionOrder(allData, subformData, balanceIndex) {
    if (allData.is_production_order !== 1 || !allData.production_order_id) {
      return; // Skip if not a production order or no production order ID
    }

    const tableMatConfirmation = subformData.map((item) => ({
      material_id: item.item_selection,
      material_required_qty: item.total_quantity || item.received_quantity || 0,
      bin_location_id: item.location_id,
    }));
    console.log("Table Mat Confirmation", balanceIndex);
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
          balance_index: balanceIndex || [],
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

  async processStockAdjustment(allData, organizationId) {
    console.log("This is all data", allData);
    const subformData = allData.stock_movement;
    const movementType = allData.movement_type;
    const balanceIndex = allData.balance_index;
    const requiredTopLevelFields = [
      "stock_movement_no",
      "movement_type",
      "issue_date",
    ];
    this.validateRequiredFields(allData, requiredTopLevelFields);

    await this.preValidateItems(subformData, movementType, allData);
    await this.updateStockMovementTable(
      allData,
      subformData,
      movementType,
      organizationId
    );

    // Update production order for Location Transfer if applicable
    if (
      movementType === "Location Transfer" &&
      allData.is_production_order === 1
    ) {
      await this.updateProductionOrder(allData, subformData, balanceIndex);
    }

    const updates = [];
    for (const item of subformData) {
      try {
        const result = await this.processItem(
          item,
          movementType,
          allData,
          organizationId
        );
        updates.push(result);
      } catch (error) {
        console.error(`Error processing item ${item.item_selection}:`, error);
        updates.push({
          itemId: item.item_selection,
          status: "failed",
          error: error.message,
        });
      }
    }

    return updates;
  }

  async updateStockMovementTable(
    allData,
    subformData,
    movementType,
    organizationId
  ) {
    const table_item_balance = allData.sm_item_balance?.table_item_balance;

    let postedStatus = "";

    if (
      movementType === "Miscellaneous Issue" ||
      movementType === "Miscellaneous Receipt" ||
      movementType === "Disposal/Scrap"
    ) {
      postedStatus = "Unposted";
    } else {
      postedStatus = "";
    }

    const stockMovementData = {
      stock_movement_no: allData.stock_movement_no,
      movement_type: allData.movement_type,
      movement_type_id: allData.movement_type_id,
      movement_reason: allData.movement_reason || null,
      issued_by: allData.issued_by,
      issue_date: allData.issue_date,
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
      organization_id: organizationId,
      posted_status: postedStatus,
      reference_documents: allData.reference_documents,
    };

    const page_status = allData.page_status ? allData.page_status : null;
    const stockMovementNo = allData.id;

    const getPrefixData = async (organizationId, movementType) => {
      const prefixEntry = await db
        .collection("prefix_configuration")
        .where({
          document_types: "Stock Movement",
          is_deleted: 0,
          organization_id: organizationId,
          is_active: 1,
          movement_type: movementType,
        })
        .get();

      const prefixData = await prefixEntry.data[0];

      return prefixData;
    };

    const updatePrefix = async (
      organizationId,
      runningNumber,
      movementType
    ) => {
      try {
        await db
          .collection("prefix_configuration")
          .where({
            document_types: "Stock Movement",
            is_deleted: 0,
            organization_id: organizationId,
            movement_type: movementType,
          })
          .update({
            running_number: parseInt(runningNumber) + 1,
            has_record: 1,
          });
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
      return existingDoc.data[0] ? false : true;
    };

    const findUniquePrefix = async (prefixData, organizationId) => {
      const now = new Date();
      let prefixToShow;
      let runningNumber = prefixData.running_number;
      let isUnique = false;
      let maxAttempts = 10;
      let attempts = 0;

      while (!isUnique && attempts < maxAttempts) {
        attempts++;
        prefixToShow = await generatePrefix(runningNumber, now, prefixData);
        isUnique = await checkUniqueness(prefixToShow, organizationId);
        if (!isUnique) {
          runningNumber++;
        }
      }

      if (!isUnique) {
        this.$message.error(
          "Could not generate a unique Stock Movement number after maximum attempts"
        );
      }

      return { prefixToShow, runningNumber };
    };

    if (page_status === "Add") {
      const prefixData = await getPrefixData(organizationId, movementType);

      if (prefixData.length !== 0) {
        const { prefixToShow, runningNumber } = await findUniquePrefix(
          prefixData,
          organizationId
        );

        await updatePrefix(organizationId, runningNumber, movementType);

        stockMovementData.stock_movement_no = prefixToShow;
      }
      const result = await this.db.collection("stock_movement").add({
        stock_movement_status: "Completed",
        ...stockMovementData,
      });

      // return new Promise((resolve, reject) => {
      //       this.runWorkflow(
      //         "1921755711809626113",
      //         { stock_movement_no: stockMovementData.stock_movement_no },
      //         (res) => {
      //           console.log("Workflow success:", res);
      //           resolve(result); // Resolve with original DB result
      //         },
      //         (err) => {
      //           console.error("Workflow error:", err);
      //           // Still resolve with the DB result, as the SM is created/updated successfully
      //           // Just log the workflow error, don't reject the whole operation
      //           resolve(result);
      //         }
      //       );
      //     });
    } else if (page_status === "Edit") {
      if (!stockMovementNo) {
        throw new Error("Stock movement number is required for editing");
      }

      const prefixData = await getPrefixData(organizationId, movementType);

      if (prefixData.length !== 0) {
        const { prefixToShow, runningNumber } = await findUniquePrefix(
          prefixData,
          organizationId
        );

        await updatePrefix(organizationId, runningNumber, movementType);

        stockMovementData.stock_movement_no = prefixToShow;
      }

      const result = await this.db
        .collection("stock_movement")
        .doc(stockMovementNo)
        .update({
          stock_movement_status: "Completed",
          ...stockMovementData,
        });

      // return new Promise((resolve, reject) => {
      //     this.runWorkflow(
      //       "1921755711809626113",
      //       { stock_movement_no: stockMovementData.stock_movement_no },
      //       (res) => {
      //         console.log("Workflow success:", res);
      //         resolve(result); // Resolve with original DB result
      //       },
      //       (err) => {
      //         console.error("Workflow error:", err);
      //         // Still resolve with the DB result, as the SM is created/updated successfully
      //         // Just log the workflow error, don't reject the whole operation
      //         resolve(result);
      //       }
      //     );
      //   });
      console.log("Stock Movement Updated:", result);
    }
  }

  async processItem(item, movementType, allData, organizationId) {
    try {
      const materialResponse = await this.db
        .collection("Item")
        .where({ id: item.item_selection })
        .get();
      const materialData = materialResponse.data[0];

      if (!materialData) {
        throw new Error(`Material not found for item ${item.item_selection}`);
      }

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

      const updates = [];
      for (const balance of balancesToProcess) {
        try {
          console.log(
            `Processing balance for ${item.item_selection} at location ${balance.location_id}`
          );

          // Capture the weighted average cost from updateQuantities
          const weightedAvgCost = await this.updateQuantities(
            materialData,
            movementType,
            balance,
            allData,
            item,
            organizationId
          );

          // Store the cost in the balance object for FIFO
          if (
            weightedAvgCost !== null &&
            materialData.material_costing_method === "First In First Out"
          ) {
            balance.calculated_fifo_cost = weightedAvgCost;
          }

          const movementResult = await this.recordInventoryMovement(
            materialData,
            movementType,
            balance,
            allData,
            item,
            organizationId
          );

          updates.push({
            balance: balance.location_id,
            status: "success",
            result: movementResult,
          });
        } catch (balanceError) {
          console.error(
            `Error processing balance for ${item.item_selection} at ${balance.location_id}:`,
            balanceError
          );

          updates.push({
            balance: balance.location_id,
            status: "error",
            error: balanceError.message,
          });

          return {
            itemId: item.item_selection,
            status: "error",
            error: balanceError.message,
          };
        }
      }

      if (
        movementType === "Miscellaneous Receipt" &&
        item.received_quantity > 0
      ) {
        try {
          await this.updateQuantities(
            materialData,
            movementType,
            {},
            allData,
            item,
            organizationId
          );
          await this.recordInventoryMovement(
            materialData,
            movementType,
            { sm_quantity: item.received_quantity },
            allData,
            item,
            organizationId
          );

          updates.push({
            type: "receipt",
            status: "success",
          });
        } catch (receiptError) {
          console.error(
            `Error processing receipt for ${item.item_selection}:`,
            receiptError
          );

          updates.push({
            type: "receipt",
            status: "error",
            error: receiptError.message,
          });
          return {
            itemId: item.item_selection,
            status: "error",
            error: receiptError.message,
          };
        }
      }

      return {
        itemId: item.item_selection,
        status: updates.some((u) => u.status === "error")
          ? "partial"
          : "success",
        details: updates,
      };
    } catch (error) {
      console.error(`Error in processItem for ${item.item_selection}:`, error);
      return {
        itemId: item.item_selection,
        status: "failed",
        error: error.message,
      };
    }
  }

  async updateQuantities(
    materialData,
    movementType,
    balance,
    allData,
    subformData,
    organizationId
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

    let weightedAverageCost = null;

    console.log(
      `updateQuantities: item ${materialData.id}, movement ${movementType}, effectiveUom: ${effectiveUom}, qtyChangeValue: ${qtyChangeValue}`
    );

    if (qtyChangeValue === 0) return null;

    if (!locationId && movementType !== "Miscellaneous Receipt") {
      throw new Error("Location ID is required");
    }

    if (!effectiveUom) {
      throw new Error(`Effective UOM is undefined for item ${materialData.id}`);
    }

    const categoryKey =
      movementType === "Location Transfer"
        ? balance.category || "Unrestricted"
        : movementType === "Miscellaneous Receipt"
        ? subformData.category || "Unrestricted"
        : balance.category || "Unrestricted";

    const categoryField = this.categoryMap[categoryKey];

    let batchId = null;

    if (
      movementType === "Miscellaneous Receipt" &&
      materialData.item_batch_management == "1"
    ) {
      console.log("Processing batch for Miscellaneous Receipt");
      batchId = await this.createBatch(
        materialData,
        qtyChangeValue,
        allData,
        subformData,
        organizationId
      );
      console.log("Obtained batchId:", batchId);
    } else if (materialData.item_batch_management == "1" && balance.batch_id) {
      batchId = balance.batch_id;
    }

    const queryConditions = {
      material_id: materialData.id,
      location_id: locationId,
    };

    if (materialData.item_batch_management == "1" && batchId) {
      queryConditions.batch_id = batchId;
      console.log(`Including batch_id ${batchId} in query conditions`);
    }

    console.log(
      "Querying for existing balance with conditions:",
      queryConditions
    );
    const balanceResponse = await this.db
      .collection(collectionName)
      .where(queryConditions)
      .get();

    let balanceData =
      balanceResponse.data && balanceResponse.data.length > 0
        ? balanceResponse.data[0]
        : null;

    console.log("Found existing balance:", balanceData ? "Yes" : "No");

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
          batch_id: batchId,
          plant_id: allData.issuing_operation_faci,
          create_user: allData.user_id || "system",
          issue_date: allData.issue_date,
          update_user: allData.user_id || "system",
          is_deleted: 0,
          tenant_id: allData.tenant_id || "000000",
          organization_id: organizationId,
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
      console.log("Creating new balance record");
      await this.db.collection(collectionName).add(updateData);
    } else {
      console.log("Updating existing balance record");
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
      weightedAverageCost = await this.updateCostingMethod(
        materialData,
        qtyChange,
        allData.issuing_operation_faci,
        subformData,
        updateData,
        organizationId
      );
    }

    if (movementType === "Location Transfer") {
      await this.updateReceivingLocation(
        materialData,
        collectionName,
        subformData.location_id,
        qtyChangeValue,
        { ...balance, batch_id: batchId },
        allData,
        subformData,
        movementType,
        organizationId
      );
    }

    return weightedAverageCost;
  }

  async updateReceivingLocation(
    materialData,
    collectionName,
    receivingLocationId,
    qtyChangeValue,
    balance,
    allData,
    subformData,
    movementType,
    organizationId
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

    // For batch-managed items, we need to check for the specific batch
    const queryConditions = {
      material_id: materialData.id,
      location_id: receivingLocationId,
    };

    // Add batch_id to query conditions for batch-managed items
    if (materialData.item_batch_management == "1" && balance.batch_id) {
      queryConditions.batch_id = balance.batch_id;
    }

    const balanceResponse = await this.db
      .collection(collectionName)
      .where(queryConditions)
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
          organization_id: organizationId,
        };

    const categoryField =
      movementType === "Location Transfer"
        ? this.categoryMap[balance.category || "Unrestricted"]
        : movementType === "Miscellaneous Receipt"
        ? this.categoryMap[subformData.category || "Unrestricted"]
        : this.categoryMap[balance.category || "Unrestricted"];

    updateData.balance_quantity =
      (updateData.balance_quantity || 0) + qtyChangeValue;
    updateData[categoryField] =
      (updateData[categoryField] || 0) + qtyChangeValue;

    updateData.update_time = new Date().toISOString();
    updateData.update_user = allData.user_id || "system";

    if (!balanceData) {
      // For new entries, ensure we're creating a properly-formatted record
      await this.db.collection(collectionName).add(updateData);
      console.log(
        `Created new ${collectionName} record for batch ${balance.batch_id} at location ${receivingLocationId}`
      );
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

      // Only update batch_id if it's a batch-managed item and not already set
      if (materialData.item_batch_management == "1") {
        updateFields.batch_id = updateData.batch_id;
      }

      await this.db
        .collection(collectionName)
        .doc(balanceData.id)
        .update(updateFields);

      console.log(
        `Updated existing ${collectionName} record for batch ${balance.batch_id} at location ${receivingLocationId}`
      );
    }
  }

  async updatePendingReceive(materialId, receivedQty, allData) {
    const pendingRecQuery = await this.db
      .collection("stock_movement")
      .where({ stock_movement_no: allData.stock_movement_no })
      .get();
  }

  async createBatch(
    materialData,
    quantity,
    allData,
    subformData,
    organizationId
  ) {
    const batchNumber = `BATCH-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 5)}`;
    const batchData = {
      batch_number: subformData.batch_id || batchNumber,
      material_id: materialData.id,
      initial_quantity: quantity,
      plant_id: allData.issuing_operation_faci,
      transaction_no: allData.stock_movement_no,
      organization_id: organizationId,
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
    balanceData,
    organizationId
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

      const costingMethod = materialData.material_costing_method;
      const qtyChangeValue =
        subformData.quantity_converted || quantityChange || 0;

      if (qtyChangeValue === 0) {
        console.log("No quantity change, skipping costing update");
        return null;
      }

      if (
        !["Weighted Average", "First In First Out", "Fixed Cost"].includes(
          costingMethod
        )
      ) {
        throw new Error(`Unsupported costing method: ${costingMethod}`);
      }

      const unitPrice =
        balanceData.unit_price && balanceData.unit_price !== 0
          ? balanceData.unit_price
          : subformData.unit_price && subformData.unit_price !== 0
          ? subformData.unit_price
          : materialData.purchase_unit_price || 0;

      if (unitPrice === 0) {
        console.warn("Unit price is zero, proceeding with costing update");
      }

      let weightedAverageCost = null;

      if (costingMethod === "Weighted Average") {
        const waQuery =
          materialData.item_batch_management == "1" && balanceData.batch_id
            ? this.db.collection("wa_costing_method").where({
                material_id: materialData.id,
                batch_id: balanceData.batch_id,
                plant_id: plantId,
              })
            : this.db.collection("wa_costing_method").where({
                material_id: materialData.id,
                plant_id: plantId,
              });

        const waResponse = await waQuery.get();
        if (!waResponse || !waResponse.data) {
          throw new Error("Failed to retrieve weighted average costing data");
        }

        const waData = waResponse.data;

        let newWaQuantity, newWaCostPrice;

        if (waData.length === 0 && qtyChangeValue > 0) {
          newWaQuantity = this.roundQty(qtyChangeValue);
          newWaCostPrice = this.roundPrice(unitPrice);

          await this.db.collection("wa_costing_method").add({
            material_id: materialData.id,
            batch_id:
              materialData.item_batch_management == "1"
                ? balanceData.batch_id
                : null,
            plant_id: plantId,
            organization_id: organizationId,
            wa_quantity: newWaQuantity,
            wa_cost_price: newWaCostPrice,
            created_at: new Date().toISOString(),
          });
        } else if (waData.length > 0) {
          console.log("WA Data found:", {
            count: waData.length,
            firstItem: waData[0],
            dataTypes: waData.map((item) => typeof item),
            hasCreatedAt: waData.map((item) => Boolean(item.created_at)),
            hasId: waData.map((item) => Boolean(item.id)),
          });

          let latestWa;
          try {
            latestWa = waData.sort(
              (a, b) =>
                new Date(b.created_at || 0) - new Date(a.created_at || 0)
            )[0];

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

          const currentQty = this.roundQty(latestWa.wa_quantity || 0);
          const currentCostPrice = this.roundPrice(latestWa.wa_cost_price || 0);

          if (qtyChangeValue > 0) {
            newWaQuantity = this.roundQty(currentQty + qtyChangeValue);
            const currentTotalCost = this.roundPrice(
              currentCostPrice * currentQty
            );
            const newTotalCost = this.roundPrice(unitPrice * qtyChangeValue);
            newWaCostPrice =
              newWaQuantity > 0
                ? this.roundPrice(
                    (currentTotalCost + newTotalCost) / newWaQuantity
                  )
                : 0;
          } else {
            const deliveredQuantity = Math.abs(qtyChangeValue);
            newWaQuantity = this.roundQty(currentQty - deliveredQuantity);

            if (newWaQuantity < 0) {
              throw new Error(
                `Insufficient WA quantity: available ${currentQty}, requested ${deliveredQuantity}`
              );
            }

            newWaCostPrice = currentCostPrice;
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
                plant_id: plantId,
              })
            : this.db.collection("fifo_costing_history").where({
                material_id: materialData.id,
                plant_id: plantId,
              });

        const fifoResponse = await fifoQuery.get();
        if (!fifoResponse || !fifoResponse.data) {
          throw new Error("Failed to retrieve FIFO costing data");
        }

        const fifoData = Array.isArray(fifoResponse.data)
          ? fifoResponse.data
          : [];

        if (qtyChangeValue > 0) {
          const latestSequence =
            fifoData.length > 0
              ? Math.max(...fifoData.map((record) => record.fifo_sequence || 0))
              : 0;

          await this.db.collection("fifo_costing_history").add({
            material_id: materialData.id,
            batch_id:
              materialData.item_batch_management == "1"
                ? balanceData.batch_id
                : null,
            plant_id: plantId,
            organization_id: organizationId,
            fifo_initial_quantity: this.roundQty(qtyChangeValue),
            fifo_available_quantity: this.roundQty(qtyChangeValue),
            fifo_cost_price: this.roundPrice(unitPrice),
            fifo_sequence: latestSequence + 1,
            created_at: new Date().toISOString(),
          });
        } else if (qtyChangeValue < 0) {
          let remainingDeduction = Math.abs(qtyChangeValue);
          const fifoDeductions = []; // Track deductions for weighted average

          const sortedFifoData = fifoData.sort(
            (a, b) => (a.fifo_sequence || 0) - (b.fifo_sequence || 0)
          );

          const totalAvailable = this.roundQty(
            sortedFifoData.reduce(
              (sum, record) => sum + (record.fifo_available_quantity || 0),
              0
            )
          );

          if (totalAvailable < remainingDeduction) {
            throw new Error(
              `Insufficient FIFO quantity: available ${totalAvailable}, requested ${remainingDeduction}`
            );
          }

          for (const record of sortedFifoData) {
            if (remainingDeduction <= 0) break;

            const available = this.roundQty(
              record.fifo_available_quantity || 0
            );
            if (available <= 0) continue;

            const deduction = Math.min(available, remainingDeduction);
            const newAvailable = this.roundQty(available - deduction);

            // Store the deduction details for weighted average calculation
            fifoDeductions.push({
              quantity: deduction,
              costPrice: this.roundPrice(record.fifo_cost_price || 0),
            });

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

          // Calculate weighted average cost for FIFO
          if (fifoDeductions.length > 0) {
            const totalCost = fifoDeductions.reduce(
              (sum, d) => sum + d.quantity * d.costPrice,
              0
            );
            const totalQty = fifoDeductions.reduce(
              (sum, d) => sum + d.quantity,
              0
            );
            weightedAverageCost = this.roundPrice(totalCost / totalQty);
            console.log(
              `FIFO weighted average cost calculated: ${weightedAverageCost}`
            );
          }
        }
      } else if (costingMethod === "Fixed Cost") {
        console.log("Fixed Cost method - no costing records to update");
        return null;
      }

      return weightedAverageCost;
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

  // Function to get latest FIFO cost price with available quantity check
  async getLatestFIFOCostPrice(
    materialData,
    batchId,
    plantId,
    deductionQty = null
  ) {
    try {
      const query =
        materialData.item_batch_management == "1" && batchId
          ? this.db.collection("fifo_costing_history").where({
              material_id: materialData.id,
              batch_id: batchId,
              plant_id: plantId,
            })
          : this.db
              .collection("fifo_costing_history")
              .where({ material_id: materialData.id, plant_id: plantId });

      const response = await query.get();
      const result = response.data;

      if (!result || !Array.isArray(result) || result.length === 0) {
        console.warn(`No FIFO records found for material ${materialData.id}`);
        return 0;
      }

      const sortedRecords = result.sort(
        (a, b) => a.fifo_sequence - b.fifo_sequence
      );

      if (deductionQty && deductionQty > 0) {
        let remainingQtyToDeduct = this.roundQty(deductionQty);
        let totalCost = 0;
        let totalDeductedQty = 0;

        for (const record of sortedRecords) {
          if (remainingQtyToDeduct <= 0) break;

          const availableQty = this.roundQty(
            record.fifo_available_quantity || 0
          );
          if (availableQty <= 0) continue;

          const costPrice = this.roundPrice(record.fifo_cost_price || 0);
          const qtyToDeduct = Math.min(availableQty, remainingQtyToDeduct);

          totalCost += qtyToDeduct * costPrice;
          totalDeductedQty += qtyToDeduct;
          remainingQtyToDeduct -= qtyToDeduct;
        }

        return totalDeductedQty > 0
          ? this.roundPrice(totalCost / totalDeductedQty)
          : 0;
      }

      // First look for records with available quantity
      for (const record of sortedRecords) {
        const availableQty = this.roundQty(record.fifo_available_quantity || 0);
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
    } catch (error) {
      console.error(
        `Error retrieving FIFO cost price for ${materialData.id}:`,
        error
      );
      return 0;
    }
  }

  // Function to get Weighted Average cost price
  async getWeightedAverageCostPrice(materialData, batchId, plantId) {
    try {
      const query =
        materialData.item_batch_management == "1" && batchId
          ? this.db.collection("wa_costing_method").where({
              material_id: materialData.id,
              batch_id: batchId,
              plant_id: plantId,
            })
          : this.db
              .collection("wa_costing_method")
              .where({ material_id: materialData.id, plant_id: plantId });

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
    materialData,
    movementType,
    balance,
    allData,
    subformData,
    organizationId
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

    let unitPrice =
      balance.unit_price && balance.unit_price !== 0
        ? balance.unit_price
        : subformData.unit_price && subformData.unit_price !== 0
        ? subformData.unit_price
        : materialData.purchase_unit_price || 0;

    console.log("unitPrice JN", unitPrice);

    if (materialData.material_costing_method === "First In First Out") {
      // Check for calculated FIFO cost first
      if (
        balance.calculated_fifo_cost !== undefined &&
        balance.calculated_fifo_cost !== null
      ) {
        unitPrice = balance.calculated_fifo_cost;
        console.log(
          `Using calculated FIFO weighted average cost: ${unitPrice}`
        );
      } else {
        const isDeductionMovement = [
          "Miscellaneous Issue",
          "Disposal/Scrap",
          "Location Transfer",
        ].includes(movementType);
        const deductionQty = isDeductionMovement
          ? balance.quantity_converted || balance.sm_quantity
          : null;

        // Fallback to existing logic for non-deduction movements
        const fifoCostPrice = await this.getLatestFIFOCostPrice(
          materialData,
          balance.batch_id,
          allData.issuing_operation_faci,
          deductionQty
        );
        unitPrice = this.roundPrice(fifoCostPrice);
      }
    } else if (materialData.material_costing_method === "Weighted Average") {
      const waCostPrice = await this.getWeightedAverageCostPrice(
        materialData,
        balance.batch_id,
        allData.issuing_operation_faci
      );
      unitPrice = this.roundPrice(waCostPrice);
    } else if (materialData.material_costing_method === "Fixed Cost") {
      const fixedCostPrice = await this.getFixedCostPrice(materialData.id);
      unitPrice = this.roundPrice(fixedCostPrice);
    } else {
      return Promise.resolve();
    }

    let receiptUnitPrice = unitPrice;
    if (movementType === "Miscellaneous Receipt") {
      receiptUnitPrice =
        balance.unit_price && balance.unit_price !== 0
          ? balance.unit_price
          : subformData.unit_price && subformData.unit_price !== 0
          ? subformData.unit_price
          : materialData.purchase_unit_price || 0;
    }

    const formattedUnitPrice = this.roundPrice(
      movementType === "Miscellaneous Receipt" ? receiptUnitPrice : unitPrice
    );
    const formattedConvertedQty = this.roundQty(convertedQty);
    const formattedOriginalQty = this.roundQty(originalQty);

    console.log("formattedUnitPrice JN", formattedUnitPrice);

    const baseMovementData = {
      transaction_type: "SM",
      trx_no: allData.stock_movement_no,
      unit_price: formattedUnitPrice,
      total_price: this.roundPrice(formattedUnitPrice * formattedConvertedQty),
      quantity: formattedOriginalQty,
      item_id: materialData.id,
      inventory_category: balance.category || subformData.category,
      uom_id: effectiveUom,
      base_qty: formattedConvertedQty,
      base_uom_id: materialData.based_uom,
      batch_number_id:
        materialData.item_batch_management == "1" ? balance.batch_id : null,
      costing_method_id: materialData.material_costing_method,
      plant_id: allData.issuing_operation_faci,
      created_at: new Date(),
      organization_id: organizationId,
    };

    console.log("baseMovementData JN", baseMovementData);

    switch (movementType) {
      case "Location Transfer":
        let productionOrderNo = null;
        if (allData.is_production_order === 1) {
          const productionOrder = await this.db
            .collection("production_order")
            .where({
              id: allData.production_order_id,
            })
            .get();
          productionOrderNo =
            productionOrder.data[0]?.production_order_no || null;
          console.log("Production Order No:", productionOrderNo);
        }
        const outMovement = {
          ...baseMovementData,
          movement: "OUT",
          parent_trx_no: productionOrderNo,
          bin_location_id: balance.location_id,
          inventory_category: balance.category || "Unrestricted",
        };
        const inMovement = {
          ...baseMovementData,
          movement: "IN",
          bin_location_id: subformData.location_id,
          parent_trx_no: productionOrderNo,
          inventory_category: balance.category || "Unrestricted",
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
        console.log("outData JN", outData);
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
      const movementType = allData.movement_type;

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
              movementType === "Location Transfer"
                ? this.categoryMap[balance.category || "Unrestricted"]
                : this.categoryMap[
                    balance.category || subformData.category || "Unrestricted"
                  ];
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
                        plant_id: allData.issuing_operation_faci,
                      })
                    : this.db.collection("fifo_costing_history").where({
                        material_id: materialData.id,
                        plant_id: allData.issuing_operation_faci,
                      });

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

      console.log("⭐ Validation successful - all checks passed");
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
      console.error("❌ Validation failed with error:", error.message);
      throw error;
    }
  }
}

// Modified processFormData to use preCheckQuantitiesAndCosting
async function processFormData(db, formData, context, organizationId) {
  const adjuster = new StockAdjuster(db);
  let results;

  if (context) {
    adjuster.getParamsVariables = context.getParamsVariables.bind(context);
    //adjuster.getParamsVariables = this.getParamsVariables('page_status');
    adjuster.parentGenerateForm = context.parentGenerateForm;
  }

  const closeDialog = () => {
    if (context.parentGenerateForm) {
      context.parentGenerateForm.$refs.SuPageDialogRef.hide();
      context.parentGenerateForm.refresh();
      context.hideLoading();
    }
  };

  try {
    console.log("🔍 About to run validation checks");
    const isValid = await adjuster.preCheckQuantitiesAndCosting(
      formData,
      context
    );
    console.log("✅ Validation result:", isValid);

    if (isValid) {
      console.log("📝 Starting stock adjustment processing");
      results = await adjuster.processStockAdjustment(formData, organizationId);
      console.log("✓ Stock adjustment completed");
    }
    return results;
  } catch (error) {
    console.error("❌ Error in processFormData:", error.message);
    throw error;
  } finally {
    closeDialog();
  }
}

// Add this at the bottom of your Save as Completed button handler
const self = this;
const allData = self.getValues();
let organizationId = this.getVarGlobal("deptParentId");
if (organizationId === "0") {
  organizationId = this.getVarSystem("deptIds").split(",")[0];
}
this.showLoading();

processFormData(db, allData, self, organizationId)
  .then((results) => {
    if (allData.page_status === "Add") {
      self.hideLoading();
      self.$message.success("Stock movement created successfully");
      self.parentGenerateForm.$refs.SuPageDialogRef.hide();
      self.parentGenerateForm.refresh();
    } else if (allData.page_status === "Edit") {
      self.hideLoading();
      self.$message.success("Stock movement updated successfully");
      self.parentGenerateForm.$refs.SuPageDialogRef.hide();
      self.parentGenerateForm.refresh();
    }
  })
  .catch((error) => {
    console.error("Error in processFormData:", error);
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    self.hideLoading();
    self.$message.error(error.message || "An unknown error occurred");
  });
