const updateInventory = async (data, plantId, organizationId) => {
  const items = data.table_prt;

  // Helper function to check if item is serialized
  const isSerializedItem = (materialData) => {
    return materialData && materialData.serial_number_management === 1;
  };

  // Helper function to parse balance index for serial numbers
  const parseBalanceIndexForSerials = (balanceIndexData) => {
    return balanceIndexData.filter(
      (balance) =>
        balance.serial_number &&
        balance.serial_number.trim() !== "" &&
        (balance.return_quantity || balance.prt_quantity) > 0
    );
  };

  // Update FIFO inventory
  const updateFIFOInventory = async (
    materialId,
    returnQty,
    batchId,
    plantId
  ) => {
    try {
      // Get all FIFO records for this material sorted by sequence (oldest first)
      const query = batchId
        ? db.collection("fifo_costing_history").where({
            material_id: materialId,
            batch_id: batchId,
            plant_id: plantId,
          })
        : db
            .collection("fifo_costing_history")
            .where({ material_id: materialId, plant_id: plantId });

      const response = await query.get();

      const result = response.data;

      if (result && Array.isArray(result) && result.length > 0) {
        // Sort by FIFO sequence (lowest/oldest first)
        const sortedRecords = result.sort(
          (a, b) => a.fifo_sequence - b.fifo_sequence
        );

        let remainingQtyToDeduct = roundQty(returnQty);
        console.log(
          `Need to deduct ${remainingQtyToDeduct} units from FIFO inventory for material ${materialId}`
        );

        // Process each FIFO record in sequence until we've accounted for all return quantity
        for (const record of sortedRecords) {
          if (remainingQtyToDeduct <= 0) {
            break;
          }

          const availableQty = roundQty(record.fifo_available_quantity || 0);
          console.log(
            `FIFO record ${record.fifo_sequence} has ${availableQty} available`
          );

          // Calculate how much to take from this record
          const qtyToDeduct = Math.min(availableQty, remainingQtyToDeduct);
          const newAvailableQty = roundQty(availableQty - qtyToDeduct);

          console.log(
            `Deducting ${qtyToDeduct} from FIFO record ${record.fifo_sequence}, new available: ${newAvailableQty}`
          );

          // Update this FIFO record
          await db.collection("fifo_costing_history").doc(record.id).update({
            fifo_available_quantity: newAvailableQty,
          });

          // Reduce the remaining quantity to deduct
          remainingQtyToDeduct = roundQty(remainingQtyToDeduct - qtyToDeduct);
        }

        if (remainingQtyToDeduct > 0) {
          console.warn(
            `Warning: Couldn't fully satisfy FIFO deduction for material ${materialId}. Remaining qty: ${remainingQtyToDeduct}`
          );
        }
      } else {
        console.warn(`No FIFO records found for material ${materialId}`);
      }
    } catch (error) {
      console.error(
        `Error updating FIFO inventory for material ${materialId}:`,
        error
      );
      throw error;
    }
  };

  const updateWeightedAverage = (item, returnQty, batchId, plantId) => {
    // Input validation
    if (
      !item ||
      !item.material_id ||
      isNaN(parseFloat(returnQty)) ||
      parseFloat(returnQty) <= 0
    ) {
      console.error("Invalid item data for weighted average update:", item);
      return Promise.resolve();
    }

    const query = batchId
      ? db.collection("wa_costing_method").where({
          material_id: item.material_id,
          batch_id: batchId,
          plant_id: plantId,
        })
      : db
          .collection("wa_costing_method")
          .where({ material_id: item.material_id, plant_id: plantId });

    return query
      .get()
      .then((waResponse) => {
        const waData = waResponse.data;

        if (!waData || !Array.isArray(waData) || waData.length === 0) {
          console.warn(
            `No weighted average records found for material ${item.material_id}`
          );
          return Promise.resolve();
        }

        // Sort by date (newest first) to get the latest record
        waData.sort((a, b) => {
          if (a.created_at && b.created_at) {
            return new Date(b.created_at) - new Date(a.created_at);
          }
          return 0;
        });

        const waDoc = waData[0];
        const waCostPrice = roundPrice(waDoc.wa_cost_price || 0);
        const waQuantity = roundQty(waDoc.wa_quantity || 0);

        if (waQuantity <= returnQty) {
          console.warn(
            `Warning: Cannot fully update weighted average for ${item.material_id} - ` +
              `Available: ${waQuantity}, Requested: ${returnQty}`
          );

          if (waQuantity <= 0) {
            return Promise.resolve();
          }
        }

        const newWaQuantity = Math.max(0, roundQty(waQuantity - returnQty));

        // If new quantity would be zero, handle specially
        if (newWaQuantity === 0) {
          return db
            .collection("wa_costing_method")
            .doc(waDoc.id)
            .update({
              wa_quantity: 0,
              updated_at: new Date(),
            })
            .then(() => {
              console.log(
                `Updated Weighted Average for item ${item.material_id} to zero quantity`
              );
              return Promise.resolve();
            });
        }

        // const calculatedWaCostPrice = roundPrice(
        //   (waCostPrice * waQuantity - waCostPrice * returnQty) / newWaQuantity
        // );

        return db
          .collection("wa_costing_method")
          .doc(waDoc.id)
          .update({
            wa_quantity: newWaQuantity,
            wa_cost_price: waCostPrice,
            updated_at: new Date(),
          })
          .then(() => {
            console.log(
              `Successfully processed Weighted Average for item ${item.material_id}, ` +
                `new quantity: ${newWaQuantity}, new cost price: ${waCostPrice}`
            );
            return Promise.resolve();
          });
      })
      .catch((error) => {
        console.error(
          `Error processing Weighted Average for item ${
            item?.material_id || "unknown"
          }:`,
          error
        );
        return Promise.reject(error);
      });
  };

  // Function to get latest FIFO cost price with available quantity check
  const getLatestFIFOCostPrice = async (materialId, batchId, plantId) => {
    try {
      const query = batchId
        ? db.collection("fifo_costing_history").where({
            material_id: materialId,
            batch_id: batchId,
            plant_id: plantId,
          })
        : db
            .collection("fifo_costing_history")
            .where({ material_id: materialId, plant_id: plantId });

      const response = await query.get();
      const result = response.data;

      if (result && Array.isArray(result) && result.length > 0) {
        // Sort by FIFO sequence (lowest/oldest first, as per FIFO principle)
        const sortedRecords = result.sort(
          (a, b) => a.fifo_sequence - b.fifo_sequence
        );

        // First look for records with available quantity
        for (const record of sortedRecords) {
          const availableQty = roundQty(record.fifo_available_quantity || 0);
          if (availableQty > 0) {
            console.log(
              `Found FIFO record with available quantity: Sequence ${record.fifo_sequence}, Cost price ${record.fifo_cost_price}`
            );
            return roundPrice(record.fifo_cost_price || 0);
          }
        }

        // If no records with available quantity, use the most recent record
        console.warn(
          `No FIFO records with available quantity found for ${materialId}, using most recent cost price`
        );
        return roundPrice(
          sortedRecords[sortedRecords.length - 1].fifo_cost_price || 0
        );
      }

      console.warn(`No FIFO records found for material ${materialId}`);
      return 0;
    } catch (error) {
      console.error(
        `Error retrieving FIFO cost price for ${materialId}:`,
        error
      );
      return 0;
    }
  };

  // Function to get Weighted Average cost price
  const getWeightedAverageCostPrice = async (materialId, batchId, plantId) => {
    try {
      const query = batchId
        ? db.collection("wa_costing_method").where({
            material_id: materialId,
            batch_id: batchId,
            plant_id: plantId,
          })
        : db
            .collection("wa_costing_method")
            .where({ material_id: materialId, plant_id: plantId });

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

        return roundPrice(waData[0].wa_cost_price || 0);
      }

      console.warn(
        `No weighted average records found for material ${materialId}`
      );
      return 0;
    } catch (error) {
      console.error(`Error retrieving WA cost price for ${materialId}:`, error);
      return 0;
    }
  };

  // Function to get Fixed Cost price
  const getFixedCostPrice = async (materialId) => {
    const query = db.collection("Item").where({ id: materialId });
    const response = await query.get();
    const result = response.data;
    return roundPrice(result[0].purchase_unit_price || 0);
  };

  // Function to update serial balance for serialized items
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
    try {
      console.log(
        `Updating serial balance for ${serialNumber}: ${category} change ${qtyChange}`
      );

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
      const categoryMap = {
        Unrestricted: "unrestricted_qty",
        Reserved: "reserved_qty",
        "Quality Inspection": "qualityinsp_qty",
        Blocked: "block_qty",
      };

      const categoryField = categoryMap[category] || "unrestricted_qty";
      const currentCategoryQty = roundQty(
        parseFloat(existingBalance[categoryField] || 0)
      );
      const currentBalanceQty = roundQty(
        parseFloat(existingBalance.balance_quantity || 0)
      );

      const newCategoryQty = roundQty(currentCategoryQty - Math.abs(qtyChange)); // Always subtract for return
      const newBalanceQty = roundQty(currentBalanceQty - Math.abs(qtyChange));

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
        updated_at: new Date(),
      };

      await db
        .collection("item_serial_balance")
        .doc(existingBalance.id)
        .update(updateData);

      console.log(
        `Updated serial balance for ${serialNumber}: ${category}=${newCategoryQty}, Balance=${newBalanceQty}`
      );

      return true;
    } catch (error) {
      console.error(
        `Error updating serial balance for ${serialNumber}:`,
        error
      );
      throw error;
    }
  };

  // Function to create serial movement records
  const createSerialMovementRecord = async (
    inventoryMovementId,
    serialNumber,
    batchId,
    baseQty,
    baseUOM,
    plantId,
    organizationId
  ) => {
    try {
      const invSerialMovementRecord = {
        inventory_movement_id: inventoryMovementId,
        serial_number: serialNumber,
        batch_id: batchId || null,
        base_qty: roundQty(baseQty),
        base_uom: baseUOM,
        plant_id: plantId,
        organization_id: organizationId,
        created_at: new Date(),
      };

      await db.collection("inv_serial_movement").add(invSerialMovementRecord);
      console.log(`Created inv_serial_movement for serial: ${serialNumber}`);

      return true;
    } catch (error) {
      console.error(
        `Error creating serial movement record for ${serialNumber}:`,
        error
      );
      throw error;
    }
  };

  // Main function to process serialized item returns
  const processSerializedItemReturn = async (
    item,
    materialData,
    balanceIndexData,
    plant_id,
    organization_id,
    allData
  ) => {
    console.log(
      `Processing serialized item ${item.material_id} with ${balanceIndexData.length} serial balances`
    );

    const serialBalances = parseBalanceIndexForSerials(balanceIndexData);

    if (serialBalances.length === 0) {
      console.log(
        `No serial numbers found for serialized item ${item.material_id}`
      );
      return;
    }

    // Calculate total return quantity for costing updates
    let totalReturnQuantity = 0;

    for (const balance of serialBalances) {
      const returnQuantity = balance.return_quantity || balance.prt_quantity;
      totalReturnQuantity += returnQuantity;
    }

    console.log(
      `Serialized item ${item.material_id} total return quantity: ${totalReturnQuantity}`
    );

    // Update costing methods (WA/FIFO) for serialized items
    if (totalReturnQuantity > 0) {
      try {
        console.log(
          `Updating costing for serialized item ${item.material_id}, return quantity: ${totalReturnQuantity}`
        );

        const costingMethod = materialData.material_costing_method;
        const batchId =
          materialData.item_batch_management == "1" ? item.batch_id : null;

        if (costingMethod === "First In First Out") {
          await updateFIFOInventory(
            item.material_id,
            totalReturnQuantity,
            batchId,
            plant_id
          );
        } else if (costingMethod === "Weighted Average") {
          await updateWeightedAverage(
            item,
            totalReturnQuantity,
            batchId,
            plant_id
          );
        }
      } catch (error) {
        console.error(
          `Error updating costing for serialized item ${item.material_id}:`,
          error
        );
        throw error;
      }
    }

    // Step 1: Update individual serial balances
    for (const balance of serialBalances) {
      const serialNumber = balance.serial_number;
      const batchId =
        materialData.item_batch_management == "1" ? balance.batch_id : null;
      const locationId = balance.location_id;
      const category =
        balance.inventory_category || balance.category || "Unrestricted";
      const returnQuantity = balance.return_quantity || balance.prt_quantity;

      console.log(
        `Processing serial balance for ${serialNumber} with quantity ${returnQuantity} in category ${category}`
      );

      try {
        await updateSerialBalance(
          item.material_id,
          serialNumber,
          batchId,
          locationId,
          category,
          returnQuantity, // For returns, we subtract from inventory
          plant_id,
          organization_id
        );
      } catch (error) {
        console.error(
          `Error processing serial balance for ${serialNumber}:`,
          error
        );
        throw error;
      }
    }

    // Step 2: Group serial balances by location + batch + category for consolidated inventory movements
    const groupedBalances = new Map();

    for (const balance of serialBalances) {
      const batchId =
        materialData.item_batch_management == "1" ? balance.batch_id : null;
      const locationId = balance.location_id;
      const category =
        balance.inventory_category || balance.category || "Unrestricted";

      // Create grouping key: location + batch + category
      const groupKey = `${locationId || "no-location"}|${
        batchId || "no-batch"
      }|${category}`;

      if (!groupedBalances.has(groupKey)) {
        groupedBalances.set(groupKey, {
          location_id: locationId,
          batch_id: batchId,
          category: category,
          total_quantity: 0,
          serial_numbers: [],
        });
      }

      const group = groupedBalances.get(groupKey);
      const returnQuantity = balance.return_quantity || balance.prt_quantity;
      group.total_quantity += returnQuantity;
      group.serial_numbers.push({
        serial_number: balance.serial_number,
        quantity: returnQuantity,
      });
    }

    console.log(
      `Grouped ${serialBalances.length} serial balances into ${groupedBalances.size} consolidated inventory movements`
    );

    // Step 3: Create consolidated inventory movements for each group
    for (const [groupKey, group] of groupedBalances) {
      console.log(
        `Creating consolidated inventory movement for group: ${groupKey}, total qty: ${group.total_quantity}`
      );

      try {
        // Calculate pricing based on costing method
        let unitPrice = roundPrice(item.unit_price || 0);
        let totalPrice = roundPrice(item.unit_price * group.total_quantity);

        const costingMethod = materialData.material_costing_method;

        if (costingMethod === "First In First Out") {
          const fifoCostPrice = await getLatestFIFOCostPrice(
            item.material_id,
            group.batch_id,
            plant_id
          );
          unitPrice = roundPrice(fifoCostPrice);
          totalPrice = roundPrice(fifoCostPrice * group.total_quantity);
        } else if (costingMethod === "Weighted Average") {
          const waCostPrice = await getWeightedAverageCostPrice(
            item.material_id,
            group.batch_id,
            plant_id
          );
          unitPrice = roundPrice(waCostPrice);
          totalPrice = roundPrice(waCostPrice * group.total_quantity);
        } else if (costingMethod === "Fixed Cost") {
          const fixedCostPrice = await getFixedCostPrice(item.material_id);
          unitPrice = roundPrice(fixedCostPrice);
          totalPrice = roundPrice(fixedCostPrice * group.total_quantity);
        }

        // Create consolidated inventory movement
        const inventoryMovementData = {
          transaction_type: "PRT",
          trx_no: allData.purchase_return_no,
          parent_trx_no: item.gr_number || allData.po_no_display,
          movement: "OUT", // Purchase return is OUT movement
          unit_price: unitPrice,
          total_price: totalPrice,
          quantity: roundQty(group.total_quantity),
          item_id: item.material_id,
          inventory_category: group.category,
          uom_id: item.return_uom_id || materialData.based_uom,
          base_qty: roundQty(group.total_quantity),
          base_uom_id: materialData.based_uom,
          bin_location_id: group.location_id,
          batch_number_id: group.batch_id,
          costing_method_id: materialData.material_costing_method,
          created_at: new Date(),
          plant_id: plant_id,
          organization_id: organization_id,
        };

        await db.collection("inventory_movement").add(inventoryMovementData);
        console.log(
          `Consolidated inventory movement created for group ${groupKey}`
        );

        // Wait and fetch the created movement ID
        await new Promise((resolve) => setTimeout(resolve, 100));

        const movementQuery = await db
          .collection("inventory_movement")
          .where({
            transaction_type: "PRT",
            trx_no: allData.purchase_return_no,
            parent_trx_no: item.gr_number || allData.po_no_display,
            movement: "OUT",
            inventory_category: group.category,
            item_id: item.material_id,
            bin_location_id: group.location_id,
            base_qty: roundQty(group.total_quantity),
            plant_id: plant_id,
            organization_id: organization_id,
          })
          .get();

        if (movementQuery.data && movementQuery.data.length > 0) {
          const movementId = movementQuery.data[0].id;
          console.log(`Retrieved inventory movement ID: ${movementId}`);

          // Step 4: Create individual serial movement records for each serial in this group
          for (const serialInfo of group.serial_numbers) {
            await createSerialMovementRecord(
              movementId,
              serialInfo.serial_number,
              group.batch_id,
              serialInfo.quantity,
              materialData.based_uom,
              plant_id,
              organization_id
            );
          }
        } else {
          console.error(
            `Failed to retrieve inventory movement for group ${groupKey}`
          );
          throw new Error(
            `Failed to retrieve inventory movement for group ${groupKey}`
          );
        }

        console.log(
          `Created ${group.serial_numbers.length} serial movement records for group ${groupKey}`
        );
      } catch (groupError) {
        console.error(`Error processing group ${groupKey}:`, groupError);
        throw groupError;
      }
    }

    console.log(
      `Successfully processed ${serialBalances.length} serial balances in ${groupedBalances.size} consolidated movements for item ${item.material_id}`
    );
  };

  if (Array.isArray(items)) {
    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const item = items[itemIndex];
      console.log(
        `Processing item ${itemIndex + 1}/${items.length}: ${item.material_id}`
      );

      try {
        // Check if item has stock control enabled
        const itemRes = await db
          .collection("Item")
          .where({ id: item.material_id })
          .get();

        if (!itemRes.data || !itemRes.data.length) {
          console.error(`Item not found: ${item.material_id}`);
          continue;
        }

        const itemData = itemRes.data[0];
        if (itemData.stock_control === 0) {
          console.log(
            `Skipping inventory update for item ${item.material_id} (stock_control=0)`
          );
          continue;
        }

        const temporaryData = item.temp_qty_data
          ? JSON.parse(item.temp_qty_data)
          : [];
        console.log(
          `Temporary data for item ${item.material_id}:`,
          temporaryData
        );

        // Check if item is serialized and handle accordingly
        if (isSerializedItem(itemData)) {
          console.log(
            `Item ${item.material_id} is serialized, using serial balance processing`
          );
          try {
            await processSerializedItemReturn(
              item,
              itemData,
              temporaryData,
              plantId,
              organizationId,
              data
            );
          } catch (error) {
            console.error(
              `Error processing serialized item ${item.material_id}:`,
              error
            );
            throw error;
          }
          continue; // Skip regular balance processing for serialized items
        }

        if (temporaryData.length > 0) {
          for (const temp of temporaryData) {
            const itemBalanceParams = {
              material_id: item.material_id,
              location_id: temp.location_id,
            };

            // UOM Conversion
            let altQty = roundQty(temp.return_quantity);
            let baseQty = altQty;
            let altUOM = item.return_uom_id;
            let baseUOM = itemData.based_uom;
            let altWAQty = roundQty(item.return_quantity);
            let baseWAQty = altWAQty;

            if (
              Array.isArray(itemData.table_uom_conversion) &&
              itemData.table_uom_conversion.length > 0
            ) {
              console.log(`Checking UOM conversions for item ${item.item_id}`);

              const uomConversion = itemData.table_uom_conversion.find(
                (conv) => conv.alt_uom_id === altUOM
              );

              if (uomConversion) {
                console.log(
                  `Found UOM conversion: 1 ${uomConversion.alt_uom_id} = ${uomConversion.base_qty} ${uomConversion.base_uom_id}`
                );

                baseQty = roundQty(altQty * uomConversion.base_qty);
                baseWAQty = roundQty(altWAQty * uomConversion.base_qty);

                console.log(
                  `Converted ${altQty} ${altUOM} to ${baseQty} ${baseUOM}`
                );
              } else {
                console.log(
                  `No conversion found for UOM ${altUOM}, using as-is`
                );
              }
            } else {
              console.log(
                `No UOM conversion table for item ${item.item_id}, using received quantity as-is`
              );
            }

            const costingMethod = itemData.material_costing_method;

            let unitPrice = roundPrice(item.unit_price);
            let totalPrice = roundPrice(unitPrice * altQty);

            if (costingMethod === "First In First Out") {
              // Get unit price from latest FIFO sequence
              const fifoCostPrice = await getLatestFIFOCostPrice(
                item.material_id,
                temp.batch_id,
                plantId
              );
              unitPrice = roundPrice(fifoCostPrice);
              totalPrice = roundPrice(fifoCostPrice * baseQty);
            } else if (costingMethod === "Weighted Average") {
              // Get unit price from WA cost price
              const waCostPrice = await getWeightedAverageCostPrice(
                item.material_id,
                temp.batch_id,
                plantId
              );
              unitPrice = roundPrice(waCostPrice);
              totalPrice = roundPrice(waCostPrice * baseQty);
            } else if (costingMethod === "Fixed Cost") {
              // Get unit price from Fixed Cost
              const fixedCostPrice = await getFixedCostPrice(item.material_id);
              unitPrice = roundPrice(fixedCostPrice);
              totalPrice = roundPrice(fixedCostPrice * baseQty);
            } else {
              return Promise.resolve();
            }

            // Create inventory movement record
            await db.collection("inventory_movement").add({
              transaction_type: "PRT",
              trx_no: data.purchase_return_no,
              parent_trx_no: item.gr_number || data.po_no_display,
              movement: "OUT",
              unit_price: unitPrice,
              total_price: totalPrice,
              quantity: altQty,
              item_id: item.material_id,
              inventory_category: temp.inventory_category,
              uom_id: altUOM,
              base_qty: baseQty,
              base_uom_id: baseUOM,
              bin_location_id: temp.location_id,
              batch_number_id: temp.batch_id,
              costing_method_id: item.costing_method,
              plant_id: plantId,
              organization_id: organizationId,
            });

            const categoryType = temp.inventory_category;
            const categoryValue = baseQty;

            if (temp.batch_id) {
              itemBalanceParams.batch_id = temp.batch_id;

              const batchResponse = await db
                .collection("item_batch_balance")
                .where(itemBalanceParams)
                .get();

              const batchResult = batchResponse.data;
              const hasBatchBalance =
                batchResult &&
                Array.isArray(batchResult) &&
                batchResult.length > 0;
              const existingBatchDoc = hasBatchBalance ? batchResult[0] : null;

              if (existingBatchDoc && existingBatchDoc.id) {
                let updatedUnrestrictedQty = roundQty(
                  existingBatchDoc.unrestricted_qty || 0
                );
                let updatedQualityInspectionQty = roundQty(
                  existingBatchDoc.qualityinsp_qty || 0
                );
                let updatedBlockQty = roundQty(existingBatchDoc.block_qty || 0);
                let updatedIntransitQty = roundQty(
                  existingBatchDoc.intransit_qty || 0
                );

                if (categoryType === "Unrestricted") {
                  updatedUnrestrictedQty = roundQty(
                    updatedUnrestrictedQty - categoryValue
                  );
                } else if (categoryType === "Quality Inspection") {
                  updatedQualityInspectionQty = roundQty(
                    updatedQualityInspectionQty - categoryValue
                  );
                } else if (categoryType === "Blocked") {
                  updatedBlockQty = roundQty(updatedBlockQty - categoryValue);
                } else if (categoryType === "In Transit") {
                  updatedIntransitQty = roundQty(
                    updatedIntransitQty - categoryValue
                  );
                }

                const updatedBalanceQty = roundQty(
                  parseFloat(existingBatchDoc.balance_quantity || 0) -
                    categoryValue
                );

                await db
                  .collection("item_batch_balance")
                  .doc(existingBatchDoc.id)
                  .update({
                    unrestricted_qty: updatedUnrestrictedQty,
                    qualityinsp_qty: updatedQualityInspectionQty,
                    block_qty: updatedBlockQty,
                    intransit_qty: updatedIntransitQty,
                    balance_quantity: updatedBalanceQty,
                    last_updated: new Date(),
                    last_transaction: data.purchase_return_no,
                  });

                console.log(
                  `Updated batch balance for item ${item.material_id}, batch ${temp.batch_id}`
                );
              } else {
                console.log(
                  `No existing item_batch_balance found for item ${item.material_id}, batch ${temp.batch_id}`
                );
              }
            } else {
              const balanceResponse = await db
                .collection("item_balance")
                .where(itemBalanceParams)
                .get();

              const balanceResult = balanceResponse.data;
              const hasBalance =
                balanceResult &&
                Array.isArray(balanceResult) &&
                balanceResult.length > 0;
              const existingDoc = hasBalance ? balanceResult[0] : null;

              if (existingDoc && existingDoc.id) {
                let updatedUnrestrictedQty = roundQty(
                  existingDoc.unrestricted_qty || 0
                );
                let updatedQualityInspectionQty = roundQty(
                  existingDoc.qualityinsp_qty || 0
                );
                let updatedBlockQty = roundQty(existingDoc.block_qty || 0);
                let updatedIntransitQty = roundQty(
                  existingDoc.intransit_qty || 0
                );

                if (categoryType === "Unrestricted") {
                  updatedUnrestrictedQty = roundQty(
                    updatedUnrestrictedQty - categoryValue
                  );
                } else if (categoryType === "Quality Inspection") {
                  updatedQualityInspectionQty = roundQty(
                    updatedQualityInspectionQty - categoryValue
                  );
                } else if (categoryType === "Blocked") {
                  updatedBlockQty = roundQty(updatedBlockQty - categoryValue);
                } else if (categoryType === "In Transit") {
                  updatedIntransitQty = roundQty(
                    updatedIntransitQty - categoryValue
                  );
                }

                const updatedBalanceQty = roundQty(
                  parseFloat(existingDoc.balance_quantity || 0) - categoryValue
                );

                await db.collection("item_balance").doc(existingDoc.id).update({
                  unrestricted_qty: updatedUnrestrictedQty,
                  qualityinsp_qty: updatedQualityInspectionQty,
                  block_qty: updatedBlockQty,
                  intransit_qty: updatedIntransitQty,
                  balance_quantity: updatedBalanceQty,
                  last_updated: new Date(),
                  last_transaction: data.purchase_return_no,
                });

                console.log(`Updated balance for item ${item.material_id}`);
              } else {
                console.log(
                  `No existing item_balance found for item ${item.material_id}`
                );
              }
            }

            if (costingMethod === "First In First Out") {
              await updateFIFOInventory(
                item.material_id,
                baseQty,
                temp.batch_id,
                plantId
              );
            } else if (costingMethod === "Weighted Average") {
              await updateWeightedAverage(
                item,
                baseWAQty,
                temp.batch_id,
                plantId
              );
            } else {
              return Promise.resolve();
            }
          }
        }
      } catch (error) {
        console.error(`Error processing item ${item.material_id}:`, error);
      }
    }
  }
};

// For quantities - 3 decimal places
const roundQty = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(3));
};

// For prices - 4 decimal places
const roundPrice = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(4));
};

const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const validateForm = (data, requiredFields) => {
  const missingFields = [];

  requiredFields.forEach((field) => {
    const value = data[field.name];

    // Handle non-array fields (unchanged)
    if (!field.isArray) {
      if (validateField(value, field)) {
        missingFields.push(field.label);
      }
      return;
    }

    // Handle array fields
    if (!Array.isArray(value)) {
      missingFields.push(`${field.label}`);
      return;
    }

    if (value.length === 0) {
      missingFields.push(`${field.label}`);
      return;
    }

    // Check each item in the array
    if (field.arrayType === "object" && field.arrayFields && value.length > 0) {
      value.forEach((item, index) => {
        field.arrayFields.forEach((subField) => {
          const subValue = item[subField.name];
          if (validateField(subValue, subField)) {
            missingFields.push(
              `${subField.label} (in ${field.label} #${index + 1})`
            );
          }
        });
      });
    }
  });

  return missingFields;
};

const validateField = (value, field) => {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return value <= 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return !value;
};

const getPrefixData = async (organizationId) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Purchase Returns",
      is_deleted: 0,
      organization_id: organizationId,
      is_active: 1,
    })
    .get();

  const prefixData = await prefixEntry.data[0];

  return prefixData;
};

const updatePrefix = async (organizationId, runningNumber) => {
  try {
    await db
      .collection("prefix_configuration")
      .where({
        document_types: "Purchase Returns",
        is_deleted: 0,
        organization_id: organizationId,
      })
      .update({ running_number: parseInt(runningNumber) + 1, has_record: 1 });
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
  generated = generated.replace("day", String(now.getDate()).padStart(2, "0"));
  generated = generated.replace("year", now.getFullYear());
  generated = generated.replace(
    "running_number",
    String(runNumber).padStart(prefixData.padding_zeroes, "0")
  );
  return generated;
};

const checkUniqueness = async (generatedPrefix, organizationId) => {
  const existingDoc = await db
    .collection("purchase_return_head")
    .where({
      purchase_return_no: generatedPrefix,
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
    throw new Error(
      "Could not generate a unique Purchase Return number after maximum attempts"
    );
  }
  return { prefixToShow, runningNumber };
};

const updateGRandPOStatus = async (entry) => {
  const grIDs = Array.isArray(entry.gr_id) ? entry.gr_id : [entry.gr_id];

  try {
    const updateGRPromises = grIDs.map(async (grID) => {
      const filteredPRT = entry.table_prt.filter((item) => item.gr_id === grID);
      console.log(`Filtered PRT for GR ${grID}: `, filteredPRT);

      const resGR = await db
        .collection("goods_receiving")
        .where({ id: grID })
        .get();

      if (!resGR.data || resGR.data.length === 0) {
        throw new Error(`Goods Receiving with ID ${grID} not found.`);
      }

      const grData = resGR.data[0];
      const grItems = grData.table_gr || [];

      console.log(`GR Items for GR ${grID}:`, grItems);
      const filteredGR = grItems
        .map((item, index) => ({ ...item, original_index: index }))
        .filter((item) =>
          filteredPRT.some((prt) => prt.gr_line_id === item.id)
        );

      console.log(`Filtered GR items for GR ${grID}:`, filteredGR);
      let totalItems = grItems.length;
      let partiallyReturnedItem = 0;
      let fullyReturnedItem = 0;

      const updatedGRItems = grItems.map((item) => ({ ...item }));

      for (const [index, item] of filteredGR.entries()) {
        console.log(`Processing item ${index + 1}/${filteredGR.length}:`, item);
        const originalIndex = item.original_index;
        const receivedQty = item.received_qty || 0;
        const returnQty = parseFloat(filteredPRT[index]?.return_quantity || 0);

        const currentReturnedQty = parseFloat(
          updatedGRItems[originalIndex].return_quantity || 0
        );
        const totalReturnedQty = roundQty(currentReturnedQty + returnQty);

        console.log(
          `Processing GR item ${item.id} - Received: ${receivedQty}, Return: ${returnQty}, Current Returned: ${currentReturnedQty}, Total Returned: ${totalReturnedQty}`
        );

        updatedGRItems[originalIndex].return_quantity = totalReturnedQty;
      }

      for (const item of updatedGRItems) {
        if (item.return_quantity > 0) {
          partiallyReturnedItem++;
          if (item.return_quantity >= item.received_qty) {
            fullyReturnedItem++;
          }
        }
      }

      console.log(
        `Total items: ${totalItems}, Partially returned: ${partiallyReturnedItem}, Fully returned: ${fullyReturnedItem}`
      );

      let allItemReturned = fullyReturnedItem === totalItems;
      let someItemReturned = partiallyReturnedItem > 0;

      await db
        .collection("goods_receiving")
        .doc(grID)
        .update({
          table_gr: updatedGRItems,
          return_status: allItemReturned
            ? "Fully Returned"
            : someItemReturned
            ? "Partially Returned"
            : "",
        });
    });

    await Promise.all(updateGRPromises);

    const resPOLineData = await Promise.all(
      entry.table_prt.map((item) =>
        db.collection("purchase_order_2ukyuanr_sub").doc(item.po_line_id).get()
      )
    );

    console.log("Purchase Order Line Data:", resPOLineData);
    const poLineData = resPOLineData.map((res) => res.data[0]);

    console.log("PO Line Data:", poLineData);

    const updatedPOLineData = poLineData.map((item) => ({ ...item }));

    poLineData.forEach((item, index) => {
      updatedPOLineData[index].return_quantity += parseFloat(
        entry.table_prt[index]?.return_quantity || 0
      );
    });

    console.log("Updated PO Line Data:", updatedPOLineData);
    await Promise.all(
      updatedPOLineData.map((item) => {
        db.collection("purchase_order_2ukyuanr_sub").doc(item.id).update({
          return_quantity: item.return_quantity,
        });
      })
    );
  } catch (error) {
    console.error("Error updating GR and PO status:", error);
    throw error;
  }
};

const addEntry = async (organizationId, entry) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData !== null) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId
      );

      await updatePrefix(organizationId, runningNumber);

      entry.purchase_return_no = prefixToShow;
    }
    await db.collection("purchase_return_head").add(entry);
    await updateInventory(entry, entry.plant, organizationId);
    await updateGRandPOStatus(entry);

    this.runWorkflow(
      "1917415391491338241",
      { purchase_return_no: entry.purchase_return_no },
      async (res) => {
        console.log("成功结果：", res);
      },
      (err) => {
        console.error("失败结果：", err);
        closeDialog();
        throw new Error("An error occurred.");
      }
    );

    this.$message.success("Add successfully");
    await closeDialog();
  } catch (error) {
    this.$message.error(error);
  }
};

const updateEntry = async (organizationId, entry, purchaseReturnId) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData !== null) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId
      );

      await updatePrefix(organizationId, runningNumber);

      entry.purchase_return_no = prefixToShow;
    }
    await db
      .collection("purchase_return_head")
      .doc(purchaseReturnId)
      .update(entry);
    await updateInventory(entry, entry.plant, organizationId);
    await updateGRandPOStatus(entry);

    this.runWorkflow(
      "1917415391491338241",
      { purchase_return_no: entry.purchase_return_no },
      async (res) => {
        console.log("成功结果：", res);
      },
      (err) => {
        console.error("失败结果：", err);
        closeDialog();
        throw new Error("An error occurred.");
      }
    );
    this.$message.success("Update successfully");
    await closeDialog();
  } catch (error) {
    this.$message.error(error);
  }
};

const findFieldMessage = (obj) => {
  // Base case: if current object has the structure we want
  if (obj && typeof obj === "object") {
    if (obj.field && obj.message) {
      return obj.message;
    }

    // Check array elements
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findFieldMessage(item);
        if (found) return found;
      }
    }

    // Check all object properties
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const found = findFieldMessage(obj[key]);
        if (found) return found;
      }
    }
  }
  return null;
};

const fillbackHeaderFields = async (entry) => {
  try {
    for (const [index, prtLineItem] of entry.table_prt.entries()) {
      prtLineItem.supplier_id = entry.supplier_id || null;
      prtLineItem.plant_id = entry.plant || null;
      prtLineItem.billing_state_id = entry.billing_address_state || null;
      prtLineItem.billing_country_id = entry.billing_address_country || null;
      prtLineItem.shipping_state_id = entry.shipping_address_state || null;
      prtLineItem.shipping_country_id = entry.shipping_address_country || null;
      prtLineItem.line_index = index + 1;
    }
    return entry.table_prt;
  } catch (error) {
    throw new Error("Error processing purchase return.");
  }
};

const processPRTLineItem = async (entry) => {
  const totalQuantity = entry.table_prt.reduce((sum, item) => {
    const { return_quantity } = item;
    return sum + (return_quantity || 0); // Handle null/undefined received_qty
  }, 0);

  if (totalQuantity === 0) {
    throw new Error("Total return quantity is 0.");
  }

  const zeroQtyArray = [];
  for (const [index, prt] of entry.table_prt.entries()) {
    if (prt.return_quantity <= 0) {
      zeroQtyArray.push(`#${index + 1}`);
    }
  }

  if (zeroQtyArray.length > 0) {
    this.$confirm(
      `Line${zeroQtyArray.length > 1 ? "s" : ""} ${zeroQtyArray.join(", ")} ha${
        zeroQtyArray.length > 1 ? "ve" : "s"
      } a zero return quantity, which may prevent processing.\nIf you proceed, it will delete the row with 0 return quantity. \nWould you like to proceed?`,
      "Zero Return Quantity Detected",
      {
        confirmButtonText: "OK",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: false,
      }
    )
      .then(async () => {
        console.log("User clicked OK");
        entry.table_prt = entry.table_prt.filter(
          (item) => item.return_quantity > 0
        );
        for (const prt of entry.table_prt) {
          let poID = [];
          let grID = [];
          let purchaseOrderNumber = [];
          let goodsReceivingNumber = [];

          grID.push(prt.gr_id);
          goodsReceivingNumber.push(prt.gr_number);

          poID.push(prt.po_id);
          purchaseOrderNumber.push(prt.po_number);
        }

        poID = [...new Set(poID)];
        grID = [...new Set(grID)];
        purchaseOrderNumber = [...new Set(purchaseOrderNumber)];
        goodsReceivingNumber = [...new Set(goodsReceivingNumber)];

        entry.po_id = poID;
        entry.gr_id = grID;
        entry.po_no_display = purchaseOrderNumber.join(", ");
        entry.gr_no_display = goodsReceivingNumber.join(", ");

        return entry;
      })
      .catch(() => {
        // Function to execute when the user clicks "Cancel" or closes the dialog
        console.log("User clicked Cancel or closed the dialog");
        this.hideLoading();
        throw new Error("Saving purchase return cancelled.");
        // Add your logic to stop or handle cancellation here
        // Example: this.stopFunction();
      });
  }

  return entry;
};

(async () => {
  try {
    const data = this.getValues();
    this.showLoading();

    const requiredFields = [
      { name: "purchase_return_no", label: "Return ID" },
      { name: "plant", label: "Plant" },
      {
        name: "table_prt",
        label: "PRT Items",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    const missingFields = await validateForm(data, requiredFields);
    await this.validate("purchase_return_no");

    if (missingFields.length === 0) {
      const page_status = this.getValue("page_status");

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      const {
        purchase_return_no,
        po_id,
        gr_id,
        po_no_display,
        gr_no_display,
        supplier_id,
        prt_billing_address,
        prt_shipping_address,
        gr_date,
        plant,
        organization_id,
        purchase_return_date,
        return_by,
        return_delivery_method,
        purchase_return_ref,
        shipping_details,
        reason_for_return,
        pr_note,
        remark,
        reference_type,

        driver_name,
        vehicle_no,
        cp_ic_no,
        driver_contact,
        pickup_date,

        courier_company,
        shipping_date,
        estimated_arrival,
        shipping_method,
        freight_charge,

        driver_name2,
        ct_ic_no,
        driver_contact_no2,
        estimated_arrival2,
        vehicle_no2,
        delivery_cost,

        tpt_vehicle_number,
        tpt_transport_name,
        tpt_ic_no,
        tpt_driver_contact_no,

        table_prt,
        billing_address_line_1,
        billing_address_line_2,
        billing_address_line_3,
        billing_address_line_4,
        billing_address_city,
        billing_address_state,
        billing_address_country,
        billing_postal_code,
        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        shipping_address_city,
        shipping_address_state,
        shipping_address_country,
        shipping_postal_code,
        billing_address_name,
        billing_address_phone,
        billing_attention,
        shipping_address_name,
        shipping_address_phone,
        shipping_attention,
      } = data;

      const entry = {
        purchase_return_status: "Issued",
        purchase_return_no,
        po_id,
        gr_id,
        po_no_display,
        gr_no_display,
        supplier_id,
        prt_billing_address,
        prt_shipping_address,
        gr_date,
        plant,
        organization_id,
        purchase_return_date,
        return_by,
        return_delivery_method,
        purchase_return_ref,
        shipping_details,
        reason_for_return,
        pr_note,
        remark,
        reference_type,

        driver_name,
        vehicle_no,
        cp_ic_no,
        driver_contact,
        pickup_date,

        courier_company,
        shipping_date,
        estimated_arrival,
        shipping_method,
        freight_charge,

        driver_name2,
        ct_ic_no,
        driver_contact_no2,
        estimated_arrival2,
        vehicle_no2,
        delivery_cost,

        tpt_vehicle_number,
        tpt_transport_name,
        tpt_ic_no,
        tpt_driver_contact_no,

        table_prt,
        billing_address_line_1,
        billing_address_line_2,
        billing_address_line_3,
        billing_address_line_4,
        billing_address_city,
        billing_address_state,
        billing_address_country,
        billing_postal_code,
        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        shipping_address_city,
        shipping_address_state,
        shipping_address_country,
        shipping_postal_code,
        billing_address_name,
        billing_address_phone,
        billing_attention,
        shipping_address_name,
        shipping_address_phone,
        shipping_attention,
      };

      const latestPRT = await processPRTLineItem(entry);
      latestPRT.table_prt = await fillbackHeaderFields(latestPRT);

      if (page_status === "Add") {
        await addEntry(organizationId, latestPRT);
      } else if (page_status === "Edit") {
        const goodsReceivingId = this.getValue("id");
        await updateEntry(organizationId, latestPRT, goodsReceivingId);
      }
    } else {
      this.hideLoading();
      this.$message.error(`Missing fields: ${missingFields.join(", ")}`);
    }
  } catch (error) {
    this.hideLoading();

    let errorMessage = "";

    if (error && typeof error === "object") {
      errorMessage = findFieldMessage(error) || "An error occurred";
    } else {
      errorMessage = error;
    }

    this.$message.error(errorMessage);
    console.error(errorMessage);
  }
})();
