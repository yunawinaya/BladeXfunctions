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

const addInventory = async (data, plantId, organizationId) => {
  const items = data.table_gr;

  if (!Array.isArray(items) || items.length === 0) {
    console.log("No items to process");
    return Promise.resolve();
  }

  const purchaseOrderNumbers =
    typeof data.purchase_order_number === "string"
      ? data.purchase_order_number.split(",").map((num) => num.trim())
      : Array.isArray(data.purchase_order_number)
      ? data.purchase_order_number
      : [data.purchase_order_number];

  // Calculate cost price based on PO data
  const calculateCostPrice = (itemData, conversion) => {
    if (!conversion || conversion <= 0 || !isFinite(conversion)) {
      console.warn(
        `Invalid conversion factor (${conversion}) for item ${itemData.item_id}, using 1.0`
      );
      conversion = 1.0;
    }

    const relevantPoId =
      itemData.line_po_id ||
      itemData.po_id ||
      (Array.isArray(data.purchase_order_id)
        ? data.purchase_order_id[0]
        : data.purchase_order_id);

    if (!relevantPoId) {
      console.error("No relevant PO ID found for cost calculation");
      return Promise.resolve(roundPrice(itemData.unit_price));
    }

    return db
      .collection("purchase_order")
      .where({ id: relevantPoId })
      .get()
      .then((poResponse) => {
        if (!poResponse.data || !poResponse.data.length) {
          console.log(`No purchase order found for ${relevantPoId}`);
          return roundPrice(itemData.unit_price);
        }

        const poData = poResponse.data[0];

        const exchangeRate = poData.exchange_rate;
        let poQuantity = 0;
        let totalAmount = 0;

        for (const poItem of poData.table_po) {
          if (poItem.item_id === itemData.item_id) {
            poQuantity = roundQty(parseFloat(poItem.quantity) || 0);
            totalAmount = roundPrice(parseFloat(poItem.po_amount) || 0);
            break;
          }
        }

        const pricePerUnit = roundPrice(totalAmount / poQuantity);
        const costPrice = roundPrice(
          (pricePerUnit / conversion) * exchangeRate
        );
        console.log("costPrice", costPrice);

        return costPrice;
      })
      .catch((error) => {
        console.error(`Error calculating cost price: ${error.message}`);
        return roundPrice(itemData.unit_price);
      });
  };

  // Function to get Fixed Cost price
  const getFixedCostPrice = async (materialId) => {
    try {
      const query = db.collection("Item").where({ id: materialId });
      const response = await query.get();
      const result = response.data;
      if (!result || !result.length) {
        console.warn(`Item not found for fixed cost price: ${materialId}`);
        return 0;
      }
      return roundPrice(parseFloat(result[0].purchase_unit_price || 0));
    } catch (error) {
      console.error(`Error getting fixed cost price: ${error.message}`);
      return 0;
    }
  };

  // Function to process FIFO for batch
  const processFifoForBatch = async (itemData, baseQty, batchId) => {
    try {
      // Query existing FIFO records for this batch
      const fifoResponse = await db
        .collection("fifo_costing_history")
        .where({
          material_id: itemData.item_id,
          batch_id: batchId,
          plant_id: plantId,
        })
        .get();

      // Determine next sequence number
      let sequenceNumber = 1;
      if (
        fifoResponse.data &&
        Array.isArray(fifoResponse.data) &&
        fifoResponse.data.length > 0
      ) {
        const existingSequences = fifoResponse.data.map((doc) =>
          parseInt(doc.fifo_sequence || 0, 10)
        );
        sequenceNumber = Math.max(...existingSequences, 0) + 1;
        console.log(
          `FIFO for batch item ${itemData.item_id}: Found ${
            fifoResponse.data.length
          } records, max sequence: ${Math.max(
            ...existingSequences,
            0
          )}, using new sequence: ${sequenceNumber}`
        );
      }

      // Calculate cost price
      const costPrice = await calculateCostPrice(
        itemData,
        roundQty(baseQty / parseFloat(itemData.received_qty))
      );

      // Create FIFO record
      const fifoData = {
        fifo_cost_price: roundPrice(costPrice),
        fifo_initial_quantity: roundQty(baseQty),
        fifo_available_quantity: roundQty(baseQty),
        material_id: itemData.item_id,
        batch_id: batchId,
        fifo_sequence: sequenceNumber,
        plant_id: plantId,
        organization_id: organizationId,
      };

      await db.collection("fifo_costing_history").add(fifoData);
      console.log(
        `Successfully processed FIFO for batch item ${itemData.item_id} with sequence ${sequenceNumber}`
      );
    } catch (error) {
      console.error(`Error processing FIFO for batch: ${error.message}`);
      throw error;
    }
  };

  // Function to process FIFO for non-batch
  const processFifoForNonBatch = async (itemData, baseQty) => {
    try {
      // Query all existing FIFO records for this material and plant
      const fifoResponse = await db
        .collection("fifo_costing_history")
        .where({
          material_id: itemData.item_id,
          plant_id: plantId,
        })
        .get();

      // Determine the next sequence number
      let sequenceNumber = 1;
      if (
        fifoResponse.data &&
        Array.isArray(fifoResponse.data) &&
        fifoResponse.data.length > 0
      ) {
        // Parse all sequence numbers as integers and find the maximum
        const existingSequences = fifoResponse.data.map((doc) =>
          parseInt(doc.fifo_sequence || 0, 10)
        );
        sequenceNumber = Math.max(...existingSequences, 0) + 1;
        console.log(
          `FIFO for ${itemData.item_id}: Found ${
            fifoResponse.data.length
          } records, max sequence: ${Math.max(
            ...existingSequences,
            0
          )}, using new sequence: ${sequenceNumber}`
        );
      } else {
        console.log(
          `FIFO for ${itemData.item_id}: No existing records, using sequence: 1`
        );
      }

      // Calculate the cost price
      const costPrice = await calculateCostPrice(
        itemData,
        roundQty(baseQty / parseFloat(itemData.received_qty))
      );

      // Prepare the FIFO data
      const fifoData = {
        fifo_cost_price: roundPrice(costPrice),
        fifo_initial_quantity: roundQty(baseQty),
        fifo_available_quantity: roundQty(baseQty),
        material_id: itemData.item_id,
        fifo_sequence: sequenceNumber,
        plant_id: plantId,
        organization_id: organizationId,
      };

      // Add the FIFO record
      await db.collection("fifo_costing_history").add(fifoData);
      console.log(
        `Successfully processed FIFO for item ${itemData.item_id} with sequence ${sequenceNumber}`
      );
    } catch (error) {
      console.error(
        `Error processing FIFO for item ${itemData.item_id}:`,
        error
      );
      throw error;
    }
  };

  // Function to process Weighted Average for batch
  const processWeightedAverageForBatch = async (item, baseQty, batchId) => {
    try {
      const costPrice = await calculateCostPrice(
        item,
        roundQty(baseQty / parseFloat(item.received_qty))
      );

      await db.collection("wa_costing_method").add({
        material_id: item.item_id,
        batch_id: batchId,
        plant_id: plantId,
        organization_id: organizationId,
        wa_quantity: roundQty(baseQty),
        wa_cost_price: roundPrice(costPrice),
        created_at: new Date(),
      });

      console.log(
        `Successfully processed Weighted Average for batch item ${item.item_id}`
      );
    } catch (error) {
      console.error(
        `Error processing Weighted Average for batch item ${item.item_id}:`,
        error
      );
      throw error;
    }
  };

  // Function to process Weighted Average for non-batch
  const processWeightedAverageForNonBatch = async (item, baseQty) => {
    try {
      // Query existing weighted average records
      const waResponse = await db
        .collection("wa_costing_method")
        .where({
          material_id: item.item_id,
          plant_id: plantId,
        })
        .get();

      const waData = waResponse.data;

      if (waData && waData.length) {
        // Sort records by date, newest first
        waData.sort((a, b) => {
          if (a.created_at && b.created_at) {
            return new Date(b.created_at) - new Date(a.created_at);
          }
          return 0;
        });

        const latestWa = waData[0];
        const waCostPrice = roundPrice(latestWa.wa_cost_price);
        const waQuantity = roundQty(latestWa.wa_quantity);
        const newWaQuantity = roundQty(waQuantity + baseQty);

        // Calculate cost price and new weighted average
        const costPrice = await calculateCostPrice(
          item,
          roundQty(baseQty / parseFloat(item.received_qty))
        );

        const calculatedWaCostPrice = roundPrice(
          (waCostPrice * waQuantity + costPrice * baseQty) / newWaQuantity
        );

        const newWaCostPrice = roundPrice(calculatedWaCostPrice);

        // Update existing record
        await db.collection("wa_costing_method").doc(latestWa.id).update({
          wa_quantity: newWaQuantity,
          wa_cost_price: newWaCostPrice,
          plant_id: plantId,
          organization_id: organizationId,
          updated_at: new Date(),
        });

        console.log(
          `Updated Weighted Average for item ${item.item_id}: quantity=${newWaQuantity}, price=${newWaCostPrice}`
        );
      } else {
        // Create new weighted average record
        const costPrice = await calculateCostPrice(
          item,
          roundQty(baseQty / parseFloat(item.received_qty))
        );

        await db.collection("wa_costing_method").add({
          material_id: item.item_id,
          wa_quantity: roundQty(baseQty),
          wa_cost_price: roundPrice(costPrice),
          plant_id: plantId,
          organization_id: organizationId,
          created_at: new Date(),
        });

        console.log(
          `Created new Weighted Average for item ${item.item_id}: quantity=${baseQty}, price=${costPrice}`
        );
      }
    } catch (error) {
      console.error(
        `Error processing Weighted Average for item ${item.item_id}:`,
        error
      );
      throw error;
    }
  };

  // Function to update PO with received quantities
  const updateOnOrderPurchaseOrder = async (
    item,
    baseQty,
    purchaseOrderNumbers,
    data
  ) => {
    try {
      const poNumbers = Array.isArray(purchaseOrderNumbers)
        ? purchaseOrderNumbers
        : typeof purchaseOrderNumbers === "string"
        ? purchaseOrderNumbers.split(",").map((num) => num.trim())
        : [];

      if (poNumbers.length === 0) {
        console.warn(
          `No purchase order numbers found for item ${item.item_id}`
        );
        return;
      }

      let itemPoNumber = item.line_po_no;

      if (!itemPoNumber && item.line_po_id) {
        const poId = item.line_po_id;
        const poIdArray = Array.isArray(data.purchase_order_id)
          ? data.purchase_order_id
          : [data.purchase_order_id];

        if (poIdArray.includes(poId) && poIdArray.length === poNumbers.length) {
          const index = poIdArray.indexOf(poId);
          if (index !== -1 && index < poNumbers.length) {
            itemPoNumber = poNumbers[index];
          }
        }
      }

      const poNumbersToCheck = itemPoNumber ? [itemPoNumber] : poNumbers;

      for (const poNumber of poNumbersToCheck) {
        const poResponse = await db
          .collection("on_order_purchase_order")
          .where({
            purchase_order_number: poNumber,
            material_id: item.item_id,
          })
          .get();

        if (
          poResponse.data &&
          Array.isArray(poResponse.data) &&
          poResponse.data.length > 0
        ) {
          const doc = poResponse.data[0];
          if (doc && doc.id) {
            const existingReceived = roundQty(
              parseFloat(doc.received_qty || 0)
            );
            const openQuantity = roundQty(parseFloat(doc.open_qty || 0));
            const newReceived = roundQty(
              existingReceived + parseFloat(baseQty || 0)
            );
            let newOpenQuantity = roundQty(
              openQuantity - parseFloat(baseQty || 0)
            );

            if (newOpenQuantity < 0) {
              newOpenQuantity = 0;
            }

            await db.collection("on_order_purchase_order").doc(doc.id).update({
              received_qty: newReceived,
              open_qty: newOpenQuantity,
            });

            console.log(
              `Updated on_order_purchase_order for PO ${poNumber}, item ${item.item_id}: received=${newReceived}, open=${newOpenQuantity}`
            );
            return;
          }
        }
      }

      console.warn(
        `No matching on_order_purchase_order record found for item ${
          item.item_id
        } in POs: ${poNumbersToCheck.join(", ")}`
      );
    } catch (error) {
      console.error(
        `Error updating on_order_purchase_order for item ${item.item_id}:`,
        error
      );
    }
  };

  // Process items sequentially instead of in parallel
  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const item = items[itemIndex];
    console.log(`Processing item ${itemIndex + 1}/${items.length}`);

    // Input validation
    if (
      !item.item_id ||
      !item.received_qty ||
      isNaN(parseFloat(item.received_qty)) ||
      parseFloat(item.received_qty) <= 0
    ) {
      console.error(`Invalid item data for index ${itemIndex}:`, item);
      console.log(
        `Skipping item with zero or invalid received quantity: ${item.item_id}`
      );
      continue;
    }

    try {
      // First check if this item should be processed based on stock_control
      const itemRes = await db
        .collection("Item")
        .where({ id: item.item_id })
        .get();

      if (!itemRes.data || !itemRes.data.length) {
        console.error(`Item not found: ${item.item_id}`);
        continue;
      }

      const itemData = itemRes.data[0];
      if (itemData.stock_control === 0) {
        console.log(
          `Skipping inventory update for item ${item.item_id} (stock_control=0)`
        );
        continue;
      }

      // UOM Conversion
      let altQty = roundQty(parseFloat(item.received_qty));
      let baseQty = altQty;
      let altUOM = item.item_uom;
      let baseUOM = itemData.based_uom;

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

          console.log(`Converted ${altQty} ${altUOM} to ${baseQty} ${baseUOM}`);
        } else {
          console.log(`No conversion found for UOM ${altUOM}, using as-is`);
        }
      } else {
        console.log(
          `No UOM conversion table for item ${item.item_id}, using received quantity as-is`
        );
      }

      let unitPrice = roundPrice(item.unit_price);
      let totalPrice = roundPrice(item.unit_price * baseQty);

      const costingMethod = itemData.material_costing_method;

      if (
        costingMethod === "First In First Out" ||
        costingMethod === "Weighted Average"
      ) {
        const fifoCostPrice = await calculateCostPrice(
          item,
          roundQty(baseQty / parseFloat(item.received_qty))
        );
        unitPrice = roundPrice(fifoCostPrice);
        totalPrice = roundPrice(fifoCostPrice * baseQty);
      } else if (costingMethod === "Fixed Cost") {
        const fixedCostPrice = await getFixedCostPrice(item.item_id);
        unitPrice = roundPrice(fixedCostPrice);
        totalPrice = roundPrice(fixedCostPrice * baseQty);
      }

      // Create inventory_movement record
      const inventoryMovementData = {
        transaction_type: "GRN",
        trx_no: data.gr_no,
        parent_trx_no: item.line_po_no,
        movement: "IN",
        unit_price: roundPrice(unitPrice),
        total_price: roundPrice(totalPrice),
        quantity: roundQty(altQty),
        item_id: item.item_id,
        inventory_category: item.inv_category,
        uom_id: altUOM,
        base_qty: roundQty(baseQty),
        base_uom_id: baseUOM,
        bin_location_id: item.location_id,
        batch_number_id: item.item_batch_no,
        costing_method_id: item.item_costing_method,
        plant_id: plantId,
        organization_id: organizationId,
      };

      await db.collection("inventory_movement").add(inventoryMovementData);

      await updateOnOrderPurchaseOrder(
        item,
        baseQty,
        purchaseOrderNumbers,
        data
      );

      // Setup inventory category quantities
      const itemBalanceParams = {
        material_id: item.item_id,
        location_id: item.location_id,
        plant_id: plantId,
      };

      let block_qty = 0,
        reserved_qty = 0,
        unrestricted_qty = 0,
        qualityinsp_qty = 0,
        intransit_qty = 0;

      const receivedQty = roundQty(parseFloat(baseQty || 0));

      if (item.inv_category === "Blocked") {
        block_qty = receivedQty;
      } else if (item.inv_category === "Reserved") {
        reserved_qty = receivedQty;
      } else if (item.inv_category === "Unrestricted") {
        unrestricted_qty = receivedQty;
      } else if (item.inv_category === "Quality Inspection") {
        qualityinsp_qty = receivedQty;
      } else if (item.inv_category === "In Transit") {
        intransit_qty = receivedQty;
      } else {
        unrestricted_qty = receivedQty;
      }

      if (item.item_batch_no !== "-") {
        // Batch item processing
        try {
          const batchData = {
            batch_number: item.item_batch_no,
            material_id: item.item_id,
            initial_quantity: baseQty,
            goods_receiving_no: data.gr_no,
            purchase_order_no: item.line_po_no,
            plant_id: plantId,
            organization_id: organizationId,
          };

          await db.collection("batch").add(batchData);

          // Wait to ensure the batch is created before querying
          await new Promise((resolve) => setTimeout(resolve, 300));

          const response = await db
            .collection("batch")
            .where({
              batch_number: item.item_batch_no,
              material_id: item.item_id,
              goods_receiving_no: data.gr_no,
              purchase_order_no: item.line_po_no,
            })
            .get();

          const batchResult = response.data;
          if (
            !batchResult ||
            !Array.isArray(batchResult) ||
            !batchResult.length
          ) {
            console.error("Batch not found after creation");
            continue;
          }

          const batchId = batchResult[0].id;

          // Create new balance record
          balance_quantity =
            block_qty +
            reserved_qty +
            unrestricted_qty +
            qualityinsp_qty +
            intransit_qty;

          const newBalanceData = {
            material_id: item.item_id,
            location_id: item.location_id,
            batch_id: batchId,
            block_qty: block_qty,
            reserved_qty: reserved_qty,
            unrestricted_qty: unrestricted_qty,
            qualityinsp_qty: qualityinsp_qty,
            intransit_qty: intransit_qty,
            balance_quantity: balance_quantity,
            plant_id: plantId,
            organization_id: organizationId,
          };

          await db.collection("item_batch_balance").add(newBalanceData);
          console.log("Successfully added item_batch_balance record");

          if (costingMethod === "First In First Out") {
            await processFifoForBatch(item, baseQty, batchId);
          } else if (costingMethod === "Weighted Average") {
            await processWeightedAverageForBatch(item, baseQty, batchId);
          }

          console.log(
            `Successfully completed processing for batch item ${item.item_id}`
          );
        } catch (error) {
          console.error(`Error in batch processing: ${error.message}`);
          continue;
        }
      } else {
        // Non-batch item processing with async/await
        try {
          // Get current item balance records
          const balanceResponse = await db
            .collection("item_balance")
            .where(itemBalanceParams)
            .get();

          const hasExistingBalance =
            balanceResponse.data &&
            Array.isArray(balanceResponse.data) &&
            balanceResponse.data.length > 0;

          console.log(
            `Item ${item.item_id}: Found existing balance: ${hasExistingBalance}`
          );

          const existingDoc = hasExistingBalance
            ? balanceResponse.data[0]
            : null;

          let balance_quantity;

          if (existingDoc && existingDoc.id) {
            // Update existing balance
            console.log(
              `Updating existing balance for item ${item.item_id} at location ${item.location_id}`
            );

            const updatedBlockQty = roundQty(
              parseFloat(existingDoc.block_qty || 0) + block_qty
            );
            const updatedReservedQty = roundQty(
              parseFloat(existingDoc.reserved_qty || 0) + reserved_qty
            );
            const updatedUnrestrictedQty = roundQty(
              parseFloat(existingDoc.unrestricted_qty || 0) + unrestricted_qty
            );
            const updatedQualityInspQty = roundQty(
              parseFloat(existingDoc.qualityinsp_qty || 0) + qualityinsp_qty
            );
            const updatedIntransitQty = roundQty(
              parseFloat(existingDoc.intransit_qty || 0) + intransit_qty
            );

            balance_quantity =
              updatedBlockQty +
              updatedReservedQty +
              updatedUnrestrictedQty +
              updatedQualityInspQty +
              updatedIntransitQty;

            await db.collection("item_balance").doc(existingDoc.id).update({
              block_qty: updatedBlockQty,
              reserved_qty: updatedReservedQty,
              unrestricted_qty: updatedUnrestrictedQty,
              qualityinsp_qty: updatedQualityInspQty,
              intransit_qty: updatedIntransitQty,
              balance_quantity: balance_quantity,
            });

            console.log(
              `Updated balance for item ${item.item_id}: ${balance_quantity}`
            );
          } else {
            // Create new balance record
            console.log(
              `Creating new balance for item ${item.item_id} at location ${item.location_id}`
            );

            balance_quantity =
              block_qty +
              reserved_qty +
              unrestricted_qty +
              qualityinsp_qty +
              intransit_qty;

            const newBalanceData = {
              material_id: item.item_id,
              location_id: item.location_id,
              block_qty: block_qty,
              reserved_qty: reserved_qty,
              unrestricted_qty: unrestricted_qty,
              qualityinsp_qty: qualityinsp_qty,
              intransit_qty: intransit_qty,
              balance_quantity: balance_quantity,
              plant_id: plantId,
              organization_id: organizationId,
            };

            await db.collection("item_balance").add(newBalanceData);
            console.log(
              `Created new balance for item ${item.item_id}: ${balance_quantity}`
            );
          }

          // Process costing method
          if (costingMethod === "First In First Out") {
            await processFifoForNonBatch(item, baseQty);
          } else if (costingMethod === "Weighted Average") {
            await processWeightedAverageForNonBatch(item, baseQty);
          }

          console.log(`Successfully processed non-batch item ${item.item_id}`);
        } catch (nonBatchError) {
          console.error(
            `Error processing non-batch item: ${nonBatchError.message}`
          );
          continue;
        }
      }
    } catch (error) {
      console.error(`Error processing item ${item.item_id}:`, error);
      console.log(
        `Error encountered for item ${item.item_id}, continuing with next item`
      );
    }
  }

  return Promise.resolve();
};

// Enhanced PO status update with proper error handling
const updatePurchaseOrderStatus = async (purchaseOrderIds) => {
  const poIds = Array.isArray(purchaseOrderIds)
    ? purchaseOrderIds
    : [purchaseOrderIds];
  try {
    // Fetch purchase order and related goods receiving documents in parallel
    const updatePromises = poIds.map(async (purchaseOrderId) => {
      try {
        // Fetch purchase order and related goods receiving documents in parallel
        const [resGR, resPO] = await Promise.all([
          db
            .collection("goods_receiving")
            .where({ purchase_order_id: purchaseOrderId })
            .get(),
          db.collection("purchase_order").where({ id: purchaseOrderId }).get(),
        ]);

        // Validate purchase order exists
        if (!resPO.data || !resPO.data.length) {
          console.warn(`Purchase order ${purchaseOrderId} not found`);
          return;
        }

        const poDoc = resPO.data[0];
        const originalPOStatus = poDoc.po_status;
        const poItems = poDoc.table_po || [];

        // Validate PO has items
        if (!poItems.length) {
          console.warn(`No items found in purchase order ${purchaseOrderId}`);
          return;
        }

        const allGRs = resGR.data || [];

        // Initialize tracking objects
        const receivedQtyMap = {};
        let totalOrderedQty = 0;
        let totalReceivedQty = 0;

        // Create a copy of the PO items to update later
        const updatedPoItems = JSON.parse(JSON.stringify(poItems));

        // Initialize with zeros and calculate total ordered quantity
        poItems.forEach((item) => {
          const itemId = item.item_id;
          const orderedQty = parseFloat(item.quantity || 0);

          receivedQtyMap[itemId] = 0;
          totalOrderedQty += orderedQty;
        });

        // Sum received quantities from all GRs
        allGRs.forEach((gr) => {
          (gr.table_gr || []).forEach((grItem) => {
            const itemId = grItem.item_id;
            if (receivedQtyMap.hasOwnProperty(itemId)) {
              const qty = parseFloat(grItem.received_qty || 0);
              receivedQtyMap[itemId] += qty;
              totalReceivedQty += qty;
            }
          });
        });

        // Update received quantities in PO items
        updatedPoItems.forEach((item) => {
          const itemId = item.item_id;
          item.received_qty = receivedQtyMap[itemId] || 0;
        });

        // Check item completion status
        let allItemsComplete = true;
        let anyItemProcessing = false;

        poItems.forEach((item) => {
          const orderedQty = parseFloat(item.quantity || 0);
          const receivedQty = receivedQtyMap[item.item_id] || 0;

          if (receivedQty < orderedQty) {
            allItemsComplete = false;
            if (receivedQty > 0) {
              anyItemProcessing = true;
            }
          }
        });

        // Determine new status
        let newPOStatus = poDoc.po_status;
        let newGRStatus = poDoc.gr_status;

        if (allItemsComplete) {
          newPOStatus = "Completed";
          newGRStatus = "Fully Received";
        } else if (anyItemProcessing) {
          newPOStatus = "Processing";
          newGRStatus = "Partially Received";
        }

        // Format the pending/ordered quantity
        const pendingOrderedQty = `${totalReceivedQty} / ${totalOrderedQty}`;

        // Prepare a single update operation with all changes
        const updateData = {
          table_po: updatedPoItems,
          pending_ordered_qty: pendingOrderedQty,
        };

        // Only include status changes if needed
        if (newPOStatus !== poDoc.po_status) {
          updateData.po_status = newPOStatus;
        }

        if (newGRStatus !== poDoc.gr_status) {
          updateData.gr_status = newGRStatus;
        }

        // Execute a single database update
        await db.collection("purchase_order").doc(poDoc.id).update(updateData);

        // Log the status change if it occurred
        if (newPOStatus !== originalPOStatus) {
          console.log(
            `Updated PO ${purchaseOrderId} status from ${originalPOStatus} to ${newPOStatus}`
          );
        }
      } catch (error) {
        console.error(
          `Error updating purchase order ${purchaseOrderId} status:`,
          error
        );
      }
    });

    await Promise.all(updatePromises);
    return { success: true };
  } catch (error) {
    console.error(`Error in update purchase order status process:`, error);
    return {
      success: false,
      error: error.message,
    };
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
    if (field.arrayType === "object" && field.arrayFields) {
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
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return !value;
};

const getPrefixData = async (organizationId) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Goods Receiving",
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
        document_types: "Goods Receiving",
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

const checkUniqueness = async (generatedPrefix) => {
  const existingDoc = await db
    .collection("goods_receiving")
    .where({ gr_no: generatedPrefix })
    .get();
  return existingDoc.data[0] ? false : true;
};

const findUniquePrefix = async (prefixData) => {
  const now = new Date();
  let prefixToShow;
  let runningNumber = prefixData.running_number;
  let isUnique = false;
  let maxAttempts = 10;
  let attempts = 0;

  while (!isUnique && attempts < maxAttempts) {
    attempts++;
    prefixToShow = await generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(prefixToShow);
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    this.$message.error(
      "Could not generate a unique Goods Receiving number after maximum attempts"
    );
  }

  return { prefixToShow, runningNumber };
};

const addEntry = async (organizationId, entry) => {
  try {
    const prefixData = await getPrefixData(organizationId);
    if (prefixData.length !== 0) {
      await updatePrefix(organizationId, prefixData.running_number);
      await db
        .collection("goods_receiving")
        .add(entry)
        .then(() => {
          this.runWorkflow(
            "1917412667253141505",
            { gr_no: entry.gr_no },
            async (res) => {
              console.log("成功结果：", res);
            },
            (err) => {
              this.$message.error("Workflow execution failed");
              console.error("失败结果：", err);
              closeDialog();
            }
          );
        });
      await addInventory(entry, entry.plant_id, organizationId);

      const purchaseOrderIds = Array.isArray(entry.purchase_order_id)
        ? entry.purchase_order_id
        : [entry.purchase_order_id];

      await updatePurchaseOrderStatus(purchaseOrderIds);
      this.$message.success("Add successfully");
      closeDialog();
    }
  } catch (error) {
    this.$message.error(error);
  }
};

const updateEntry = async (organizationId, entry, goodsReceivingId) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData.length !== 0) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData
      );

      await updatePrefix(organizationId, runningNumber);

      entry.gr_no = prefixToShow;
      await db
        .collection("goods_receiving")
        .doc(goodsReceivingId)
        .update(entry)
        .then(() => {
          this.runWorkflow(
            "1917412667253141505",
            { gr_no: entry.gr_no },
            async (res) => {
              console.log("成功结果：", res);
            },
            (err) => {
              alert();
              console.error("失败结果：", err);
              closeDialog();
            }
          );
        });
      await addInventory(entry, entry.plant_id, organizationId);
      const purchaseOrderIds = Array.isArray(entry.purchase_order_id)
        ? entry.purchase_order_id
        : [entry.purchase_order_id];

      await updatePurchaseOrderStatus(purchaseOrderIds);
      this.$message.success("Update successfully");
      await closeDialog();
    }
  } catch (error) {
    this.$message.error(error);
  }
};

(async () => {
  try {
    const data = this.getValues();
    this.showLoading();

    const requiredFields = [
      { name: "purchase_order_id", label: "PO Number" },
      { name: "gr_no", label: "GR Number" },
      { name: "gr_date", label: "GR Date" },
      {
        name: "table_gr",
        label: "GR Items",
        isArray: true,
        arrayType: "object",
        arrayFields: [
          { name: "location_id", label: "Target Location" },
          { name: "item_batch_no", label: "Batch Number" },
          { name: "inv_category", label: "Inventory Category" },
        ],
      },
    ];

    const missingFields = await validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      const page_status = this.getValue("page_status");

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      const {
        fake_purchase_order_id,
        purchase_order_id,
        plant_id,
        currency_code,
        organization_id,
        purchase_order_number,
        gr_billing_name,
        gr_billing_cp,
        gr_billing_address,
        gr_shipping_address,
        supplier_name,
        supplier_contact_person,
        supplier_contact_number,
        supplier_email,
        gr_no,
        gr_received_by,
        gr_date,
        table_gr,
        billing_address_line_1,
        billing_address_line_2,
        billing_address_line_3,
        billing_address_line_4,
        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        billing_address_city,
        shipping_address_city,
        billing_postal_code,
        shipping_postal_code,
        billing_address_state,
        shipping_address_state,
        billing_address_country,
        shipping_address_country,
      } = data;

      const entry = {
        gr_status: "Completed",
        fake_purchase_order_id,
        purchase_order_id,
        plant_id,
        currency_code,
        organization_id,
        purchase_order_number,
        gr_billing_name,
        gr_billing_cp,
        gr_billing_address,
        gr_shipping_address,
        supplier_name,
        supplier_contact_person,
        supplier_contact_number,
        supplier_email,
        gr_no,
        gr_received_by,
        gr_date,
        table_gr,
        billing_address_line_1,
        billing_address_line_2,
        billing_address_line_3,
        billing_address_line_4,
        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        billing_address_city,
        shipping_address_city,
        billing_postal_code,
        shipping_postal_code,
        billing_address_state,
        shipping_address_state,
        billing_address_country,
        shipping_address_country,
      };

      if (page_status === "Add") {
        await addEntry(organizationId, entry);
        closeDialog();
      } else if (page_status === "Edit") {
        const goodsReceivingId = this.getValue("id");
        await updateEntry(organizationId, entry, goodsReceivingId);
        closeDialog();
      }
    } else {
      this.hideLoading();
      this.$message.error(`Missing fields: ${missingFields.join(", ")}`);
    }
  } catch (error) {
    this.hideLoading();
    this.$message.error(error);
  }
})();
