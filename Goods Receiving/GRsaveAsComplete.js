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

const addInventory = async (
  data,
  plantId,
  organizationId,
  putAwaySetupData
) => {
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

    const relevantPoId = itemData.line_po_id || itemData.po_id;

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
        const exchangeRate = poData.exchange_rate || 1;

        // Find matching items in the PO that have the same material ID
        const matchingPoItems = poData.table_po.filter(
          (poItem) => poItem.item_id === itemData.item_id
        );

        // Find the specific PO item that corresponds to this GR item
        let targetPoItem = null;

        // If we have a po_line_item_id, use it for precise matching
        if (itemData.po_line_item_id && matchingPoItems.length > 0) {
          // Try to match by po_line_item_id if it's available on the PO items
          const lineIdMatch = matchingPoItems.find(
            (poItem) =>
              poItem.id === itemData.po_line_item_id ||
              poItem.line_id === itemData.po_line_item_id
          );

          if (lineIdMatch) {
            targetPoItem = lineIdMatch;
            console.log(
              `Found exact match by po_line_item_id: ${itemData.po_line_item_id} for item ${itemData.item_id}`
            );
          }
        }

        // If we couldn't match by po_line_item_id, try matching by line_po_no if available
        if (
          !targetPoItem &&
          itemData.line_po_no &&
          matchingPoItems.length > 0
        ) {
          const lineNoMatch = matchingPoItems.find(
            (poItem) =>
              poItem.po_no === itemData.line_po_no ||
              poItem.line_po_no === itemData.line_po_no
          );

          if (lineNoMatch) {
            targetPoItem = lineNoMatch;
            console.log(
              `Found exact match by line_po_no: ${itemData.line_po_no} for item ${itemData.item_id}`
            );
          }
        }

        // If we couldn't match by direct identifiers, fall back to position-based matching
        if (!targetPoItem) {
          if (matchingPoItems.length === 1) {
            // Only one matching item, use it
            targetPoItem = matchingPoItems[0];
          } else if (matchingPoItems.length > 1) {
            // Enhanced position-based matching for multiple items

            // Find the position of this item in the GR table
            const itemPosition = data.table_gr.findIndex(
              (grItem) =>
                grItem === itemData ||
                (grItem.item_id === itemData.item_id &&
                  grItem.line_po_id === itemData.line_po_id)
            );

            // Look for uniquely identifying properties in the GR item that might match the PO
            // For example, if there's a unique property like "po_line_number" or "item_description"
            const uniqueIdentifiers = [
              "line_number",
              "po_line_number",
              "item_description",
              "item_specification",
              "line_reference",
            ];

            for (const identifier of uniqueIdentifiers) {
              if (
                itemData[identifier] &&
                matchingPoItems.some(
                  (poItem) => poItem[identifier] === itemData[identifier]
                )
              ) {
                targetPoItem = matchingPoItems.find(
                  (poItem) => poItem[identifier] === itemData[identifier]
                );
                console.log(
                  `Matched by ${identifier}: ${itemData[identifier]} for item ${itemData.item_id}`
                );
                break;
              }
            }

            // If still no match, try to match by identical price/amount
            if (!targetPoItem && itemData.total_price) {
              const priceMatch = matchingPoItems.find(
                (poItem) =>
                  Math.abs(
                    parseFloat(poItem.po_amount || 0) -
                      parseFloat(itemData.total_price || 0)
                  ) < 0.0001
              );

              if (priceMatch) {
                targetPoItem = priceMatch;
                console.log(
                  `Matched by total price: ${itemData.total_price} for item ${itemData.item_id}`
                );
              }
            }

            // Fall back to position-based matching as a last resort
            if (!targetPoItem) {
              // Count how many items with this material ID come before this one in the GR
              const itemsBeforeCount = data.table_gr
                .slice(0, itemPosition)
                .filter((grItem) => grItem.item_id === itemData.item_id).length;

              // Use this count to find the corresponding PO item
              if (itemsBeforeCount < matchingPoItems.length) {
                targetPoItem = matchingPoItems[itemsBeforeCount];
                console.log(
                  `Position-based match: Item #${
                    itemsBeforeCount + 1
                  } of type ${itemData.item_id}`
                );
              } else {
                // Fallback to the first matching item
                targetPoItem = matchingPoItems[0];
                console.warn(
                  `Couldn't find exact PO item match for ${itemData.item_id} at position ${itemPosition}, using first match`
                );
              }
            }
          }
        }

        if (!targetPoItem) {
          console.warn(
            `No matching PO item found for ${itemData.item_id}, using default pricing`
          );
          return roundPrice(itemData.unit_price);
        }

        // Extract price and quantity from the matched PO item
        const poQuantity = roundQty(parseFloat(targetPoItem.quantity) || 0);
        const totalAmount = roundPrice(parseFloat(targetPoItem.po_amount) || 0);

        // Calculate unit price and apply the conversion factor
        const pricePerUnit =
          poQuantity > 0 ? roundPrice(totalAmount / poQuantity) : 0;
        const costPrice = roundPrice(
          (pricePerUnit / conversion) * exchangeRate
        );

        console.log(
          `Cost price for ${
            itemData.item_id
          }: ${costPrice} (from PO item amount: ${totalAmount}, qty: ${poQuantity}, poItem: ${JSON.stringify(
            targetPoItem.id || "unknown"
          )})`
        );

        return costPrice;
      })
      .catch((error) => {
        console.error(
          `Error calculating cost price for ${itemData.item_id}: ${error.message}`
        );
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

  // Function to process item_balance for both batched and non-batched items
  const processItemBalance = async (item, itemBalanceParams, block_qty, reserved_qty, unrestricted_qty, qualityinsp_qty, intransit_qty) => {
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
    } catch (error) {
      console.error(`Error processing item_balance for item ${item.item_id}:`, error);
      throw error;
    }
  };

  // Function to calculate aggregated quantities for serialized items
  const calculateAggregatedSerialQuantities = (item, baseQty) => {
    try {
      // Parse serial number data if available
      if (!item.serial_number_data) {
        console.log(`No serial number data found for item ${item.item_id}`);
        return null;
      }

      let serialNumberData;
      try {
        serialNumberData = JSON.parse(item.serial_number_data);
      } catch (parseError) {
        console.error(
          `Error parsing serial number data for item ${item.item_id}:`,
          parseError
        );
        return null;
      }

      const tableSerialNumber = serialNumberData.table_serial_number || [];
      const serialQuantity = serialNumberData.serial_number_qty || 0;

      if (serialQuantity === 0 || tableSerialNumber.length === 0) {
        console.log(`No serial numbers to process for item ${item.item_id}`);
        return null;
      }

      // Calculate base quantity per serial number
      const baseQtyPerSerial = serialQuantity > 0 ? baseQty / serialQuantity : 0;

      // Initialize aggregated quantities
      let aggregated_block_qty = 0;
      let aggregated_reserved_qty = 0;
      let aggregated_unrestricted_qty = 0;
      let aggregated_qualityinsp_qty = 0;
      let aggregated_intransit_qty = 0;

      // Aggregate quantities based on inventory category
      // Since all serial numbers for an item typically have the same inventory category,
      // we can multiply the per-serial quantity by the total number of serial numbers
      if (item.inv_category === "Blocked") {
        aggregated_block_qty = baseQtyPerSerial * serialQuantity;
      } else if (item.inv_category === "Reserved") {
        aggregated_reserved_qty = baseQtyPerSerial * serialQuantity;
      } else if (item.inv_category === "Unrestricted") {
        aggregated_unrestricted_qty = baseQtyPerSerial * serialQuantity;
      } else if (item.inv_category === "Quality Inspection") {
        aggregated_qualityinsp_qty = baseQtyPerSerial * serialQuantity;
      } else if (item.inv_category === "In Transit") {
        aggregated_intransit_qty = baseQtyPerSerial * serialQuantity;
      } else {
        // Default to unrestricted if category not specified
        aggregated_unrestricted_qty = baseQtyPerSerial * serialQuantity;
      }

      console.log(
        `Aggregated serial quantities for item ${item.item_id}: ` +
        `Total serial count: ${serialQuantity}, ` +
        `Category: ${item.inv_category}, ` +
        `Per-serial qty: ${baseQtyPerSerial}, ` +
        `Total aggregated: ${aggregated_block_qty + aggregated_reserved_qty + aggregated_unrestricted_qty + aggregated_qualityinsp_qty + aggregated_intransit_qty}`
      );

      return {
        block_qty: roundQty(aggregated_block_qty),
        reserved_qty: roundQty(aggregated_reserved_qty),
        unrestricted_qty: roundQty(aggregated_unrestricted_qty),
        qualityinsp_qty: roundQty(aggregated_qualityinsp_qty),
        intransit_qty: roundQty(aggregated_intransit_qty),
        serial_count: serialQuantity
      };
    } catch (error) {
      console.error(`Error calculating aggregated serial quantities for item ${item.item_id}:`, error);
      return null;
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

      // Variable to track if we updated any records
      let updatedAnyRecords = false;

      for (const poNumber of poNumbersToCheck) {
        console.log(`Checking ${poNumber} for item ${item.item_id}`);

        // Query for matching records
        const poResponse = await db
          .collection("on_order_purchase_order")
          .where({
            purchase_order_number: poNumber,
            material_id: item.item_id,
          })
          .get();

        const OnOrderPOData = poResponse.data;

        // Check if we have multiple matching records
        if (OnOrderPOData && OnOrderPOData.length > 1) {
          console.log(
            `Found ${OnOrderPOData.length} records for item ${item.item_id} in PO ${poNumber}`
          );

          // Find the position of this item in the GR table
          const itemPosition = data.table_gr.findIndex(
            (grItem) => grItem === item
          );

          // Count how many items with this material ID come before this one in the GR
          let itemIndexInGroup = 0;

          if (itemPosition > 0) {
            itemIndexInGroup = data.table_gr
              .slice(0, itemPosition)
              .filter((grItem) => grItem.item_id === item.item_id).length;
          }

          // Use this index to find the matching on_order_purchase_order record
          // Make sure we don't go out of bounds
          const targetRecordIndex = Math.min(
            itemIndexInGroup,
            OnOrderPOData.length - 1
          );

          // Only update the record corresponding to this item
          const targetRecord = OnOrderPOData[targetRecordIndex];

          console.log(
            `Updating ${
              item.item_id
            } record at index ${targetRecordIndex} (item is #${
              itemIndexInGroup + 1
            } of its type in GR)`
          );

          if (targetRecord && targetRecord.id) {
            const existingReceived = roundQty(
              parseFloat(targetRecord.received_qty || 0)
            );
            const openQuantity = roundQty(
              parseFloat(targetRecord.open_qty || 0)
            );
            const newReceived = roundQty(
              existingReceived + parseFloat(baseQty || 0)
            );
            let newOpenQuantity = roundQty(
              openQuantity - parseFloat(baseQty || 0)
            );

            if (newOpenQuantity < 0) {
              newOpenQuantity = 0;
            }

            try {
              await db
                .collection("on_order_purchase_order")
                .doc(targetRecord.id)
                .update({
                  received_qty: newReceived,
                  open_qty: newOpenQuantity,
                });

              console.log(
                `Updated on_order_purchase_order record ${
                  targetRecordIndex + 1
                }/${OnOrderPOData.length} for PO ${poNumber}, item ${
                  item.item_id
                }: received=${newReceived}, open=${newOpenQuantity}`
              );

              updatedAnyRecords = true;
            } catch (updateError) {
              console.error(
                `Error updating on_order_purchase_order record for item ${item.item_id}:`,
                updateError
              );
            }
          }
        } else if (OnOrderPOData && OnOrderPOData.length === 1) {
          // Single record case - simpler update
          const doc = OnOrderPOData[0];
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

            try {
              await db
                .collection("on_order_purchase_order")
                .doc(doc.id)
                .update({
                  received_qty: newReceived,
                  open_qty: newOpenQuantity,
                });

              console.log(
                `Updated on_order_purchase_order for PO ${poNumber}, item ${item.item_id}: received=${newReceived}, open=${newOpenQuantity}`
              );

              updatedAnyRecords = true;
            } catch (updateError) {
              console.error(
                `Error updating on_order_purchase_order for item ${item.item_id}:`,
                updateError
              );
            }
          }
        } else {
          console.warn(
            `No on_order_purchase_order records found for PO ${poNumber}, item ${item.item_id}`
          );
        }
      }

      if (!updatedAnyRecords) {
        console.warn(
          `No matching on_order_purchase_order record found for item ${
            item.item_id
          } in POs: ${poNumbersToCheck.join(", ")}`
        );
      }
    } catch (error) {
      console.error(
        `Error updating on_order_purchase_order for item ${item.item_id}:`,
        error
      );
    }
  };

  const createInspectionLot = async (
    data,
    item,
    itemIndex,
    batchId,
    totalPrice,
    unitPrice,
    materialCode
  ) => {
    try {
      const prefixData = await getPrefixData(
        organizationId,
        "Receiving Inspection"
      );
      let inspPrefix = "";

      if (prefixData !== null) {
        const { prefixToShow, runningNumber } = await findUniquePrefix(
          prefixData,
          organizationId,
          "Receiving Inspection"
        );

        await updatePrefix(
          organizationId,
          runningNumber,
          "Receiving Inspection"
        );

        inspPrefix = prefixToShow;
      }

      let grId = null;
      const resGR = await db
        .collection("goods_receiving")
        .where({ gr_no: data.gr_no, organization_id: data.organization_id })
        .get();

      if (resGR && resGR.data[0]) {
        grId = resGR.data[0].id;
      }

      let processedSerialNumberData = item.serial_number_data;

      // Process serialized items by fetching actual generated serial numbers from database
      if (item.is_serialized_item === 1 && item.serial_number_data) {
        try {
          const serialData = JSON.parse(item.serial_number_data);

          if (
            serialData.table_serial_number &&
            serialData.table_serial_number.length > 0
          ) {
            // Check if we have "Auto generated serial number" placeholders
            const hasPlaceholders = serialData.table_serial_number.some(
              (serial) =>
                serial.system_serial_number === "Auto generated serial number"
            );

            if (hasPlaceholders) {
              // Fetch actual generated serial numbers from database
              const serialNumbersFromDB = await db
                .collection("serial_number")
                .where({
                  material_id: item.item_id,
                  transaction_no: data.gr_no,
                  organization_id: organizationId,
                })
                .get();

              if (
                serialNumbersFromDB &&
                serialNumbersFromDB.data &&
                serialNumbersFromDB.data.length > 0
              ) {
                // Use the actual generated serial numbers from database
                const updatedTableSerialNumber = serialNumbersFromDB.data.map(
                  (dbSerial) => ({
                    system_serial_number: dbSerial.system_serial_number,
                    supplier_serial_number:
                      dbSerial.supplier_serial_number || "",
                    passed: 0,
                    fm_key: "", // fm_key not stored in serial_number collection
                  })
                );

                const updatedSerialData = {
                  ...serialData,
                  table_serial_number: updatedTableSerialNumber,
                };

                processedSerialNumberData = JSON.stringify(updatedSerialData);
              } else {
                // Fallback: use original data but set passed: 0
                const updatedTableSerialNumber =
                  serialData.table_serial_number.map((serialItem) => ({
                    system_serial_number: serialItem.system_serial_number,
                    supplier_serial_number:
                      serialItem.supplier_serial_number || "",
                    passed: 0,
                    fm_key: serialItem.fm_key || "",
                  }));

                const updatedSerialData = {
                  ...serialData,
                  table_serial_number: updatedTableSerialNumber,
                };

                processedSerialNumberData = JSON.stringify(updatedSerialData);
              }
            } else {
              // No placeholders, use existing serial numbers but ensure passed: 0
              const updatedTableSerialNumber =
                serialData.table_serial_number.map((serialItem) => ({
                  system_serial_number: serialItem.system_serial_number,
                  supplier_serial_number:
                    serialItem.supplier_serial_number || "",
                  passed: 0,
                  fm_key: serialItem.fm_key || "",
                }));

              const updatedSerialData = {
                ...serialData,
                table_serial_number: updatedTableSerialNumber,
              };

              processedSerialNumberData = JSON.stringify(updatedSerialData);
            }
          }
        } catch (parseError) {
          console.error("Error processing serial number data:", parseError);
          // Keep original serial_number_data if parsing fails
        }
      }

      const inspectionData = {
        inspection_lot_no: inspPrefix,
        goods_receiving_no: grId,
        gr_no_display: data.gr_no,
        insp_lot_created_on: new Date().toISOString().split("T")[0],
        plant_id: data.plant_id,
        organization_id: data.organization_id,
        inspector_name: this.getVarGlobal("nickname"),
        receiving_insp_status: "Created",
        inspection_pass_fail: "0 / 0",
        remarks: "",
        lot_created_by: "System",
        insp_start_time: "",
        insp_end_time: "",
        table_insp_mat: [
          {
            item_id: item.item_id,
            item_code: materialCode,
            item_name: item.item_name || "",
            item_desc: item.item_desc || "",
            batch_id: batchId || "",
            received_qty: item.received_qty,
            received_uom: item.item_uom,
            passed_qty: 0,
            failed_qty: 0,
            gr_line_no: itemIndex + 1,
            batch_no: item.item_batch_no || "",
            total_price: totalPrice,
            location_id: item.location_id,
            unit_price: unitPrice,
            is_serialized_item: item.is_serialized_item,
            serial_number_data: processedSerialNumberData,
          },
        ],
      };

      await db.collection("basic_inspection_lot").add(inspectionData);
    } catch {
      throw new Error("Error creating inspection lot.");
    }
  };

  const createPutAway = async (
    data,
    organizationId,
    unitPriceArray,
    totalPriceArray
  ) => {
    try {
      const prefixData = await getPrefixData(
        organizationId,
        "Transfer Order (Putaway)"
      );
      let putAwayPrefix = "";

      if (prefixData !== null) {
        const { prefixToShow, runningNumber } = await findUniquePrefix(
          prefixData,
          organizationId,
          "Transfer Order (Putaway)"
        );

        await updatePrefix(
          organizationId,
          runningNumber,
          "Transfer Order (Putaway)"
        );

        putAwayPrefix = prefixToShow;
      }

      let grId = null;
      const resGR = await db
        .collection("goods_receiving")
        .where({ gr_no: data.gr_no, organization_id: organizationId })
        .get();

      if (resGR && resGR.data[0]) {
        grId = resGR.data[0].id;
      }

      const putAwayLineItemData = [];
      const tableGR = data.table_gr.filter((gr) => gr.item_id);
      const grWithoutQI = tableGR.filter(
        (gr) => gr.inv_category !== "Quality Inspection"
      );

      for (const [index, item] of grWithoutQI.entries()) {
        let batchNo = null;

        if (item.item_batch_no !== "-") {
          const resBatch = await db
            .collection("batch")
            .where({
              batch_number: item.item_batch_no,
              organization_id: organizationId,
            })
            .get();
          batchNo = resBatch?.data[0] || null;
        }

        // Generate serialNumbers string for serialized items using actual generated serial numbers
        let serialNumbers = "";
        if (
          item.is_serialized_item === 1 &&
          item.generated_serial_numbers &&
          Array.isArray(item.generated_serial_numbers)
        ) {
          serialNumbers = item.generated_serial_numbers.join(", ");
          console.log(
            `Using generated serial numbers for putaway item ${item.item_id}: ${serialNumbers}`
          );
        }

        const lineItemData = {
          line_index: index + 1,
          item_code: item.item_id,
          item_name: item.item_name,
          item_desc: item.item_desc,
          batch_no: batchNo?.id || "",
          source_inv_category: item.inv_category,
          target_inv_category: "Unrestricted",
          received_qty: item.received_qty,
          item_uom: item.item_uom,
          source_bin: item.location_id,
          qty_to_putaway: item.received_qty,
          pending_process_qty: item.received_qty,
          putaway_qty: 0,
          target_location: "",
          remark: "",
          qi_no: null,
          line_status: "Open",
          po_no: item.line_po_id,
          is_split: "No",
          parent_or_child: "Parent",
          parent_index: index,
          unit_price: unitPriceArray[index],
          total_price: totalPriceArray[index],
          serial_numbers: serialNumbers,
          is_serialized_item: item.is_serialized_item,
        };

        putAwayLineItemData.push(lineItemData);
      }

      const putawayData = {
        plant_id: data.plant_id,
        to_id: putAwayPrefix,
        movement_type: "Putaway",
        ref_doc_type: "Goods Receiving",
        gr_no: grId,
        receiving_no: data.gr_no,
        supplier_id: data.supplier_name,
        created_by: "System",
        assigned_to: data.assigned_to,
        created_at: new Date().toISOString().split("T")[0],
        organization_id: organizationId,
        to_status: "Created",
        table_putaway_item: putAwayLineItemData,
      };

      await db.collection("transfer_order_putaway").add(putawayData);
      await db
        .collection("goods_receiving")
        .where({ id: grId })
        .update({ putaway_status: "Created" });

      if (data.assigned_to && data.assigned_to.length > 0) {
        const notificationParam = {
          title: "New Putaway Assignment",
          body: `You have been assigned a putaway task for Goods Receiving: ${data.gr_no}. Transfer Order: ${putAwayPrefix}`,
          userId: data.assigned_to,
          data: {
            docId: putAwayPrefix,
            deepLink: `sudumobileexpo://putaway/batch/${putAwayPrefix}`,
          },
        };

        await this.runWorkflow(
          "1945684747032735745",
          notificationParam,
          async (res) => {
            console.log("Notification sent successfully:", res);
          },
          (err) => {
            this.$message.error("Workflow execution failed");
            console.error("Workflow execution failed:", err);
          }
        );
      }
    } catch {
      throw new Error("Error creating putaway.");
    }
  };

  const addSerialNumberInventory = async (
    data,
    item,
    inventoryMovementId,
    organizationId,
    plantId,
    batchId = null // Add batchId as optional parameter
  ) => {
    try {
      console.log(
        `Processing serial number inventory for item ${item.item_id}`
      );

      // Parse the serial number data
      if (!item.serial_number_data) {
        console.log(`No serial number data found for item ${item.item_id}`);
        return;
      }

      let serialNumberData;
      try {
        serialNumberData = JSON.parse(item.serial_number_data);
      } catch (parseError) {
        console.error(
          `Error parsing serial number data for item ${item.item_id}:`,
          parseError
        );
        return;
      }

      const tableSerialNumber = serialNumberData.table_serial_number || [];
      const serialQuantity = serialNumberData.serial_number_qty || 0;
      const isAuto = serialNumberData.is_auto;

      // Get item data for UOM and other details
      const itemRes = await db
        .collection("Item")
        .where({ id: item.item_id })
        .get();
      if (!itemRes.data || !itemRes.data.length) {
        console.error(`Item not found: ${item.item_id}`);
        return;
      }
      const itemData = itemRes.data[0];

      // Get UOM details
      let altQty = roundQty(parseFloat(item.received_qty));
      let baseQty = altQty;
      let altUOM = item.item_uom;
      let baseUOM = itemData.based_uom;

      // UOM Conversion
      if (
        Array.isArray(itemData.table_uom_conversion) &&
        itemData.table_uom_conversion.length > 0
      ) {
        const uomConversion = itemData.table_uom_conversion.find(
          (conv) => conv.alt_uom_id === altUOM
        );

        if (uomConversion) {
          baseQty = roundQty(altQty * uomConversion.base_qty);
          console.log(
            `Converted ${altQty} ${altUOM} to ${baseQty} ${baseUOM} for serial processing`
          );
        }
      }

      // Calculate base quantity per serial number
      const baseQtyPerSerial =
        serialQuantity > 0 ? baseQty / serialQuantity : 0;

      // Use the passed batchId if available, otherwise try to fetch it
      let finalBatchId = batchId;

      if (!finalBatchId && item.item_batch_no && item.item_batch_no !== "-") {
        try {
          const batchResponse = await db
            .collection("batch")
            .where({
              batch_number: item.item_batch_no,
              material_id: item.item_id,
              organization_id: organizationId,
            })
            .get();

          if (batchResponse.data && batchResponse.data.length > 0) {
            finalBatchId = batchResponse.data[0].id;
            console.log(
              `Found batch_id: ${finalBatchId} for batch number: ${item.item_batch_no}`
            );
          }
        } catch (batchError) {
          console.warn(
            `Could not find batch_id for batch number: ${item.item_batch_no}`,
            batchError
          );
        }
      }

      // Prepare arrays for serial number processing
      const updatedTableSerialNumber = [];
      let generatedCount = 0;
      let currentRunningNumber = null;
      let serialPrefix = "";

      // Get serial configuration if auto-generation is needed
      if (isAuto === 1) {
        const needsGeneration = tableSerialNumber.some(
          (serial) =>
            serial.system_serial_number === "Auto generated serial number"
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
            console.error(
              `No serial configuration found for organization: ${organizationId}`
            );
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

      // Setup inventory category quantities for serial balance
      let block_qty = 0,
        reserved_qty = 0,
        unrestricted_qty = 0,
        qualityinsp_qty = 0,
        intransit_qty = 0;

      if (item.inv_category === "Blocked") {
        block_qty = baseQtyPerSerial;
      } else if (item.inv_category === "Reserved") {
        reserved_qty = baseQtyPerSerial;
      } else if (item.inv_category === "Unrestricted") {
        unrestricted_qty = baseQtyPerSerial;
      } else if (item.inv_category === "Quality Inspection") {
        qualityinsp_qty = baseQtyPerSerial;
      } else if (item.inv_category === "In Transit") {
        intransit_qty = baseQtyPerSerial;
      } else {
        unrestricted_qty = baseQtyPerSerial;
      }

      const balance_quantity =
        block_qty +
        reserved_qty +
        unrestricted_qty +
        qualityinsp_qty +
        intransit_qty;

      // Process all serial numbers SEQUENTIALLY to maintain order
      console.log(
        `Processing ${tableSerialNumber.length} serial numbers sequentially for item ${item.item_id}`
      );

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
          console.log(
            `Generated serial number: ${finalSystemSerialNumber} for item ${
              item.item_id
            } (sequence ${serialIndex + 1})`
          );
        }

        // Update the table data
        updatedTableSerialNumber.push({
          ...serialItem,
          system_serial_number: finalSystemSerialNumber,
        });

        // Process this serial number record sequentially
        if (
          finalSystemSerialNumber &&
          finalSystemSerialNumber !== "" &&
          finalSystemSerialNumber !== "Auto generated serial number"
        ) {
          try {
            console.log(
              `Processing serial number ${serialIndex + 1}/${
                tableSerialNumber.length
              }: ${finalSystemSerialNumber}`
            );

            // 1. Insert serial_number record
            const serialNumberRecord = {
              system_serial_number: finalSystemSerialNumber,
              supplier_serial_number: serialItem.supplier_serial_number || "",
              material_id: item.item_id,
              batch_id: finalBatchId,
              bin_location: item.location_id,
              plant_id: plantId,
              organization_id: organizationId,
              transaction_no: data.gr_no,
              parent_trx_no: item.line_po_no || "",
            };

            await db.collection("serial_number").add(serialNumberRecord);
            console.log(
              `✓ Inserted serial_number record for ${finalSystemSerialNumber}`
            );

            // 2. Insert inv_serial_movement record
            const invSerialMovementRecord = {
              inventory_movement_id: inventoryMovementId,
              serial_number: finalSystemSerialNumber,
              batch_id: finalBatchId,
              base_qty: roundQty(baseQtyPerSerial),
              base_uom: baseUOM,
              plant_id: plantId,
              organization_id: organizationId,
            };

            await db
              .collection("inv_serial_movement")
              .add(invSerialMovementRecord);
            console.log(
              `✓ Inserted inv_serial_movement record for ${finalSystemSerialNumber}`
            );

            // 3. Insert item_serial_balance record
            const serialBalanceRecord = {
              material_id: item.item_id,
              material_uom: baseUOM,
              serial_number: finalSystemSerialNumber,
              batch_id: finalBatchId,
              plant_id: plantId,
              location_id: item.location_id,
              unrestricted_qty: roundQty(unrestricted_qty),
              block_qty: roundQty(block_qty),
              reserved_qty: roundQty(reserved_qty),
              qualityinsp_qty: roundQty(qualityinsp_qty),
              intransit_qty: roundQty(intransit_qty),
              balance_quantity: roundQty(balance_quantity),
              organization_id: organizationId,
            };

            await db.collection("item_serial_balance").add(serialBalanceRecord);
            console.log(
              `✓ Inserted item_serial_balance record for ${finalSystemSerialNumber}`
            );
          } catch (insertError) {
            console.error(
              `Failed to insert records for serial number ${finalSystemSerialNumber} (sequence ${
                serialIndex + 1
              }):`,
              insertError
            );
            throw insertError;
          }
        }
      }

      console.log(
        `✓ Successfully processed all ${tableSerialNumber.length} serial numbers for item ${item.item_id}`
      );

      // Update the serial configuration running number (only if we generated new numbers)
      if (generatedCount > 0 && currentRunningNumber !== null) {
        try {
          await db
            .collection("serial_level_config")
            .where({ organization_id: organizationId })
            .update({
              serial_running_number: currentRunningNumber + generatedCount,
            });

          console.log(
            `Updated serial running number to ${
              currentRunningNumber + generatedCount
            } after generating ${generatedCount} serial numbers`
          );
        } catch (configUpdateError) {
          console.error(
            `Error updating serial configuration:`,
            configUpdateError
          );
          // Don't throw here as the serial numbers are already created
        }
      }

      // Update the item's serial number data in the main data structure
      const updatedSerialNumberData = {
        ...serialNumberData,
        table_serial_number: updatedTableSerialNumber,
      };

      // Update the item in data.table_gr
      const itemIndex = data.table_gr.findIndex((grItem) => grItem === item);
      if (itemIndex !== -1) {
        data.table_gr[itemIndex].serial_number_data = JSON.stringify(
          updatedSerialNumberData
        );

        // Store the generated serial numbers for putaway use
        const generatedSerialNumbers = updatedTableSerialNumber
          .map((serial) => serial.system_serial_number)
          .filter(
            (serial) =>
              serial &&
              serial !== "" &&
              serial !== "Auto generated serial number"
          );
        data.table_gr[itemIndex].generated_serial_numbers =
          generatedSerialNumbers;
        console.log(
          `Stored ${
            generatedSerialNumbers.length
          } generated serial numbers for putaway: [${generatedSerialNumbers.join(
            ", "
          )}]`
        );
      }

      console.log(`Successfully processed serial number inventory for item ${item.item_id}: 
        - Generated ${generatedCount} new serial numbers
        - Total processed: ${updatedTableSerialNumber.length} serial numbers
        - All records inserted sequentially`);
    } catch (error) {
      console.error(
        `Error processing serial number inventory for item ${item.item_id}:`,
        error
      );
      throw new Error(
        `Failed to process serial number inventory for item ${item.item_id}: ${error.message}`
      );
    }
  };

  const unitPriceArray = [];
  const totalPriceArray = [];

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

      unitPriceArray.push(unitPrice);
      totalPriceArray.push(totalPrice);

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
        doc_date: data.gr_date,
        manufacturing_date: item.manufacturing_date,
        expired_date: item.expired_date,
      };

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

      const isSerializedItem =
        item.is_serialized_item === 1 && item.is_serial_allocated === 1;

      let batchId = null;

      if (item.item_batch_no !== "-") {
        // Batch item processing
        try {
          const batchData = {
            batch_number: item.item_batch_no,
            material_id: item.item_id,
            initial_quantity: baseQty,
            transaction_no: data.gr_no,
            parent_transaction_no: item.line_po_no,
            plant_id: plantId,
            organization_id: organizationId,
          };

          // Create the batch and get the response
          const batchResponse = await db.collection("batch").add(batchData);

          // Get the batch_id from the add response if available
          let batchId = batchResponse?.id || null;

          // If we don't get the ID from the response, query for it with retries
          if (!batchId) {
            let retryCount = 0;
            const maxRetries = 5;
            const retryDelay = 500; // Start with 500ms delay

            while (!batchId && retryCount < maxRetries) {
              await new Promise((resolve) =>
                setTimeout(resolve, retryDelay * (retryCount + 1))
              );

              const response = await db
                .collection("batch")
                .where({
                  batch_number: item.item_batch_no,
                  material_id: item.item_id,
                  transaction_no: data.gr_no,
                  parent_transaction_no: item.line_po_no,
                  organization_id: organizationId,
                })
                .get();

              if (response.data && response.data.length > 0) {
                batchId = response.data[0].id;
                console.log(
                  `Found batch_id: ${batchId} after ${retryCount + 1} retries`
                );
              }

              retryCount++;
            }

            if (!batchId) {
              console.error("Failed to get batch_id after maximum retries");
              throw new Error(
                `Failed to create or retrieve batch for ${item.item_batch_no}`
              );
            }
          } else {
            console.log(`Got batch_id from response: ${batchId}`);
          }

          inventoryMovementData.batch_number_id = batchId;
          await db
            .collection("inventory_movement")
            .add(inventoryMovementData)
            .then((res) => {
              console.log(
                `Created inventory movement with ID: ${res.id} for batch item ${item.item_id}`
              );
            });

          // Now process serial numbers if this is a serialized item
          if (item.is_serialized_item === 1 && item.is_serial_allocated === 1) {
            const inventoryMovementId = await db
              .collection("inventory_movement")
              .where({
                transaction_type: "GRN",
                trx_no: data.gr_no,
                parent_trx_no: item.line_po_no,
                movement: "IN",
                item_id: item.item_id,
                plant_id: plantId,
                organization_id: organizationId,
                bin_location_id: item.location_id,
                base_qty: roundQty(baseQty),
              })
              .get()
              .then((res) => {
                return res.data[0]?.id;
              });

            // Pass the batchId directly to avoid re-querying
            await addSerialNumberInventory(
              data,
              item,
              inventoryMovementId,
              organizationId,
              plantId,
              batchId // Pass the batchId as a parameter
            );

            console.log(
              `Created inventory movement with ID: ${inventoryMovementId} for serialized batch item ${item.item_id}`
            );
          }

          // Only create item_batch_balance for NON-serialized items
          if (!isSerializedItem) {
            // Create new balance record
            const balance_quantity =
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
              doc_date: data.gr_date,
              manufacturing_date: item.manufacturing_date,
              expired_date: item.expired_date,
            };

            await db.collection("item_batch_balance").add(newBalanceData);
            console.log(
              "Successfully added item_batch_balance record for non-serialized batch item"
            );
          } else {
            console.log(
              "Skipped item_batch_balance creation for serialized batch item"
            );
          }

          // Also create/update item_balance for batched items (both serialized and non-serialized)
          if (!isSerializedItem) {
            // Non-serialized items: use existing quantities
            await processItemBalance(item, itemBalanceParams, block_qty, reserved_qty, unrestricted_qty, qualityinsp_qty, intransit_qty);
          } else {
            // Serialized items: calculate aggregated quantities from serial number data
            const aggregatedQuantities = calculateAggregatedSerialQuantities(item, baseQty);
            if (aggregatedQuantities) {
              await processItemBalance(
                item,
                itemBalanceParams,
                aggregatedQuantities.block_qty,
                aggregatedQuantities.reserved_qty,
                aggregatedQuantities.unrestricted_qty,
                aggregatedQuantities.qualityinsp_qty,
                aggregatedQuantities.intransit_qty
              );
              console.log(`Created item_balance record for serialized batch item ${item.item_id} with ${aggregatedQuantities.serial_count} serial numbers`);
            } else {
              console.log("Skipped item_balance creation for serialized batch item - no valid serial data");
            }
          }

          // Always process costing methods (FIFO/WA) regardless of serialization
          if (costingMethod === "First In First Out") {
            await processFifoForBatch(item, baseQty, batchId);
          } else if (costingMethod === "Weighted Average") {
            await processWeightedAverageForBatch(item, baseQty, batchId);
          }

          console.log(
            `Successfully completed processing for batch item ${item.item_id}${
              isSerializedItem ? " (serialized)" : ""
            } with batch_id: ${batchId}`
          );
        } catch (error) {
          console.error(`Error in batch processing: ${error.message}`);
          // Continue to next item instead of breaking the loop
          continue;
        }
      } else {
        // Non-batch item processing with async/await
        await db
          .collection("inventory_movement")
          .add(inventoryMovementData)
          .then((res) => {
            console.log(
              `Created inventory movement with ID: ${res.id} for non-batch item ${item.item_id}`
            );
          });

        try {
          // Process serial numbers for non-batch serialized items FIRST
          if (item.is_serialized_item === 1 && item.is_serial_allocated === 1) {
            const inventoryMovementId = await db
              .collection("inventory_movement")
              .where({
                transaction_type: "GRN",
                trx_no: data.gr_no,
                parent_trx_no: item.line_po_no,
                movement: "IN",
                item_id: item.item_id,
                plant_id: plantId,
                organization_id: organizationId,
                bin_location_id: item.location_id,
                base_qty: roundQty(baseQty),
              })
              .get()
              .then((res) => {
                return res.data[0]?.id;
              });

            // Pass null as batchId since this is non-batch
            await addSerialNumberInventory(
              data,
              item,
              inventoryMovementId,
              organizationId,
              plantId,
              null // No batchId for non-batch items
            );

            console.log(
              `Created inventory movement with ID: ${inventoryMovementId} for serialized non-batch item ${item.item_id}`
            );
          }

          // Process item_balance for both serialized and non-serialized items
          if (!isSerializedItem) {
            // Non-serialized items: use existing quantities
            await processItemBalance(item, itemBalanceParams, block_qty, reserved_qty, unrestricted_qty, qualityinsp_qty, intransit_qty);
          } else {
            // Serialized items: calculate aggregated quantities from serial number data
            const aggregatedQuantities = calculateAggregatedSerialQuantities(item, baseQty);
            if (aggregatedQuantities) {
              await processItemBalance(
                item,
                itemBalanceParams,
                aggregatedQuantities.block_qty,
                aggregatedQuantities.reserved_qty,
                aggregatedQuantities.unrestricted_qty,
                aggregatedQuantities.qualityinsp_qty,
                aggregatedQuantities.intransit_qty
              );
              console.log(`Created item_balance record for serialized non-batch item ${item.item_id} with ${aggregatedQuantities.serial_count} serial numbers`);
            } else {
              console.log("Skipped item_balance creation for serialized non-batch item - no valid serial data");
            }
          }

          // Always process costing methods (FIFO/WA) regardless of serialization
          if (costingMethod === "First In First Out") {
            await processFifoForNonBatch(item, baseQty);
          } else if (costingMethod === "Weighted Average") {
            await processWeightedAverageForNonBatch(item, baseQty);
          }

          console.log(
            `Successfully processed non-batch item ${item.item_id}${
              isSerializedItem ? " (serialized)" : ""
            }`
          );
        } catch (nonBatchError) {
          console.error(
            `Error processing non-batch item: ${nonBatchError.message}`
          );
          continue;
        }
      }

      if (
        item.inv_category === "Quality Inspection" &&
        itemData.receiving_inspection === 1
      ) {
        await createInspectionLot(
          data,
          item,
          itemIndex,
          batchId,
          totalPrice,
          unitPrice,
          itemData.material_code
        );
      }
    } catch (error) {
      console.error(`Error processing item ${item.item_id}:`, error);
      console.log(
        `Error encountered for item ${item.item_id}, continuing with next item`
      );
    }
  }

  if (putAwaySetupData && putAwaySetupData.putaway_required === 1) {
    if (putAwaySetupData.auto_trigger_to === 1) {
      const allNoItemCode = data.table_gr.every((gr) => !gr.item_id);
      const allQICategory = data.table_gr.every(
        (gr) => gr.inv_category === "Quality Inspection"
      );

      if (!allNoItemCode && !allQICategory)
        await createPutAway(
          data,
          organizationId,
          unitPriceArray,
          totalPriceArray
        );
      else if (allQICategory && !allNoItemCode) return;
      else
        await db
          .collection("goods_receiving")
          .where({ gr_no: data.gr_no, organization_id: organizationId })
          .update({ gr_status: "Completed" });
    } else if (putAwaySetupData.auto_trigger_to === 0) {
      await db
        .collection("goods_receiving")
        .where({ gr_no: data.gr_no, organization_id: organizationId })
        .update({ putaway_status: "Not Created" });
    }
  } else if (
    !putAwaySetupData ||
    (putAwaySetupData && putAwaySetupData.putaway_required === 0)
  ) {
    await db
      .collection("goods_receiving")
      .where({ gr_no: data.gr_no, organization_id: organizationId })
      .update({ gr_status: "Completed" });
  }

  return Promise.resolve();
};

const updatePurchaseOrderStatus = async (purchaseOrderIds, tableGR) => {
  console.log("Starting updatePurchaseOrderStatus", {
    purchaseOrderIds,
    tableGRLength: tableGR.length,
  });

  const poIds = Array.isArray(purchaseOrderIds)
    ? purchaseOrderIds
    : [purchaseOrderIds];
  console.log("Normalized poIds", { poIds });

  let poDataArray = [];

  try {
    const updatePromises = poIds.map(async (purchaseOrderId) => {
      console.log(`Processing purchase order ${purchaseOrderId}`);

      try {
        const filteredGR = tableGR.filter(
          (item) => item.line_po_id === purchaseOrderId
        );
        console.log(`Filtered GR for PO ${purchaseOrderId}`, {
          filteredGRCount: filteredGR.length,
        });

        const resPO = await db
          .collection("purchase_order")
          .where({ id: purchaseOrderId })
          .get();
        console.log(`Fetched PO ${purchaseOrderId}`, { poData: resPO.data });

        if (!resPO.data || !resPO.data.length) {
          console.warn(`Purchase order ${purchaseOrderId} not found`);
          return {
            poId: purchaseOrderId,
            success: false,
            error: "Purchase order not found",
          };
        }

        const poDoc = resPO.data[0];
        const originalPOStatus = poDoc.po_status;
        console.log(`PO ${purchaseOrderId} details`, {
          poDoc,
          originalPOStatus,
        });

        const poItems = poDoc.table_po || [];
        console.log(`PO ${purchaseOrderId} items`, {
          poItemsCount: poItems.length,
        });

        if (!poItems.length) {
          console.warn(`No items found in purchase order ${purchaseOrderId}`);
          return {
            poId: purchaseOrderId,
            success: false,
            error: "No items found in purchase order",
          };
        }

        const filteredPO = poItems
          .map((item, index) => ({ ...item, originalIndex: index }))
          .filter((item) => item.item_id !== "" || item.item_desc !== "")
          .filter((item) =>
            filteredGR.some((gr) => gr.po_line_item_id === item.id)
          );
        console.log(`Filtered PO items for ${purchaseOrderId}`, {
          filteredPOCount: filteredPO.length,
        });

        let totalItems = poItems.length;
        let partiallyReceivedItems = 0;
        let fullyReceivedItems = 0;
        console.log(`Initial counts for PO ${purchaseOrderId}`, {
          totalItems,
          partiallyReceivedItems,
          fullyReceivedItems,
        });

        const updatedPoItems = poItems.map((item) => ({ ...item }));
        console.log(`Created deep copy of PO items for ${purchaseOrderId}`, {
          updatedPoItems,
        });

        filteredPO.forEach((filteredItem, filteredIndex) => {
          const originalIndex = filteredItem.originalIndex;
          const purchaseQty = parseFloat(filteredItem.quantity || 0);
          const grReceivedQty = parseFloat(
            filteredGR[filteredIndex]?.received_qty || 0
          );
          const currentReceivedQty = parseFloat(
            updatedPoItems[originalIndex].received_qty || 0
          );
          const totalReceivedQty = currentReceivedQty + grReceivedQty;

          const outstandingQty = parseFloat(purchaseQty - totalReceivedQty);
          if (outstandingQty < 0) {
            updatedPoItems[originalIndex].outstanding_quantity = 0;
          } else {
            updatedPoItems[originalIndex].outstanding_quantity = outstandingQty;
          }

          console.log(
            `Processing item ${filteredItem.id} for PO ${purchaseOrderId}`,
            {
              purchaseQty,
              grReceivedQty,
              currentReceivedQty,
              totalReceivedQty,
            }
          );

          updatedPoItems[originalIndex].received_qty = totalReceivedQty;
          updatedPoItems[originalIndex].received_ratio =
            purchaseQty > 0 ? totalReceivedQty / purchaseQty : 0;
        });

        for (const po of updatedPoItems) {
          if (po.received_qty > 0) {
            partiallyReceivedItems++;
            po.line_status = "Processing";
            if (po.received_qty >= po.quantity) {
              fullyReceivedItems++;
              po.line_status = "Completed";
            }
          }
        }

        console.log(`Updated counts for PO ${purchaseOrderId}`, {
          partiallyReceivedItems,
          fullyReceivedItems,
        });

        let allItemsComplete = fullyReceivedItems === totalItems;
        let anyItemProcessing = partiallyReceivedItems > 0;
        console.log(`Completion status for PO ${purchaseOrderId}`, {
          allItemsComplete,
          anyItemProcessing,
        });

        let newPOStatus = poDoc.po_status;
        let newGRStatus = poDoc.gr_status;

        if (poDoc.po_status !== "Completed") {
          if (allItemsComplete) {
            newPOStatus = "Completed";
            newGRStatus = "Fully Received";
          } else if (anyItemProcessing) {
            newPOStatus = "Processing";
            newGRStatus = "Partially Received";
          }
        } else {
          newPOStatus = "Completed";
          if (allItemsComplete) {
            newGRStatus = "Fully Received";
          } else if (anyItemProcessing) {
            newGRStatus = "Partially Received";
          }
        }
        console.log(`Status update for PO ${purchaseOrderId}`, {
          originalPOStatus,
          newPOStatus,
          newGRStatus,
        });

        const partiallyReceivedRatio = `${partiallyReceivedItems} / ${totalItems}`;
        const fullyReceivedRatio = `${fullyReceivedItems} / ${totalItems}`;
        console.log(`Ratios for PO ${purchaseOrderId}`, {
          partiallyReceivedRatio,
          fullyReceivedRatio,
        });

        const updateData = {
          table_po: updatedPoItems,
          partially_received: partiallyReceivedRatio,
          fully_received: fullyReceivedRatio,
        };

        if (newPOStatus !== poDoc.po_status) {
          updateData.po_status = newPOStatus;
        }

        if (newGRStatus !== poDoc.gr_status) {
          updateData.gr_status = newGRStatus;
        }
        console.log(`Prepared update data for PO ${purchaseOrderId}`, {
          updateData,
        });

        await db.collection("purchase_order").doc(poDoc.id).update(updateData);
        console.log(`Successfully updated PO ${purchaseOrderId} in database`);

        if (newPOStatus !== originalPOStatus) {
          console.log(
            `Updated PO ${purchaseOrderId} status from ${originalPOStatus} to ${newPOStatus}`
          );
        }

        return {
          poId: purchaseOrderId,
          newPOStatus,
          totalItems,
          partiallyReceivedItems,
          fullyReceivedItems,
          success: true,
        };
      } catch (error) {
        console.error(
          `Error updating purchase order ${purchaseOrderId} status:`,
          error
        );
        return {
          poId: purchaseOrderId,
          success: false,
          error: error.message,
        };
      }
    });

    const results = await Promise.all(updatePromises);
    console.log("All update promises resolved", { results });

    results.forEach((result) => {
      if (result && result.success) {
        poDataArray.push({
          po_id: result.poId,
          status: result.newPOStatus,
        });
      }
    });
    console.log("Processed results", { poDataArray });

    const successCount = results.filter((r) => r && r.success).length;
    const failCount = results.filter((r) => r && !r.success).length;

    console.log(`PO Status Update Summary: 
      Total POs: ${poIds.length}
      Successfully updated: ${successCount}
      Failed updates: ${failCount}
    `);

    return {
      po_data_array: poDataArray,
    };
  } catch (error) {
    console.error(`Error in update purchase order status process:`, error);
    return {
      po_data_array: [],
    };
  }
};

const validateForm = (data, requiredFields) => {
  const missingFields = [];

  requiredFields.forEach((field) => {
    const value = data[field.name];

    // Handle non-array fields (unchanged)
    if (!field.isArray) {
      if (validateField(value)) {
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
          if (validateField(subValue)) {
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

const validateField = (value) => {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return !value;
};

const getPrefixData = async (organizationId, documentTypes) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: documentTypes,
      is_deleted: 0,
      organization_id: organizationId,
      is_active: 1,
    })
    .get();

  const prefixData = await prefixEntry.data[0];

  return prefixData;
};

const updatePrefix = async (organizationId, runningNumber, documentTypes) => {
  try {
    await db
      .collection("prefix_configuration")
      .where({
        document_types: documentTypes,
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

const checkUniqueness = async (
  generatedPrefix,
  organizationId,
  documentTypes
) => {
  if (documentTypes === "Goods Receiving") {
    const existingDoc = await db
      .collection("goods_receiving")
      .where({ gr_no: generatedPrefix, organization_id: organizationId })
      .get();

    return existingDoc.data[0] ? false : true;
  } else if (documentTypes === "Transfer Order (Putaway)") {
    const existingDoc = await db
      .collection("transfer_order_putaway")
      .where({ to_id: generatedPrefix, organization_id: organizationId })
      .get();

    return existingDoc.data[0] ? false : true;
  } else if (documentTypes === "Receiving Inspection") {
    const existingDoc = await db
      .collection("basic_inspection_lot")
      .where({
        inspection_lot_no: generatedPrefix,
        organization_id: organizationId,
      })
      .get();

    return existingDoc.data[0] ? false : true;
  }
};

const findUniquePrefix = async (prefixData, organizationId, documentTypes) => {
  const now = new Date();
  let prefixToShow;
  let runningNumber = prefixData.running_number;
  let isUnique = false;
  let maxAttempts = 10;
  let attempts = 0;

  while (!isUnique && attempts < maxAttempts) {
    attempts++;
    prefixToShow = await generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(
      prefixToShow,
      organizationId,
      documentTypes
    );
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    this.$message.error(
      `Could not generate a unique ${documentTypes} number after maximum attempts`
    );
  }

  return { prefixToShow, runningNumber };
};

const createSerialNumberRecord = async (entry) => {
  const serialNumberRecords = [];
  for (const [index, item] of entry.table_gr.entries()) {
    if (item.is_serialized_item !== 1) {
      console.log(
        `Skipping serial number record for non-serialized item ${item.item_id}`
      );
      continue;
    }
    if (item.received_qty > 0) {
      const serialNumberRecord = {
        item_id: item.item_id,
        item_name: item.item_name,
        item_desc: item.item_desc,
        more_desc: item.more_desc,
        batch_id: item.batch_id,
        location_id: item.location_id,
        item_uom: item.item_uom,
        received_qty: item.received_qty,
        inv_category: item.inv_category,
        line_po_no: item.line_po_no,
        line_index: index + 1,
        line_remark_1: item.line_remark_1,
        line_remark_2: item.line_remark_2,
      };

      // Add serial numbers for serialized items with line break formatting
      if (
        item.is_serialized_item === 1 &&
        item.generated_serial_numbers &&
        Array.isArray(item.generated_serial_numbers)
      ) {
        serialNumberRecord.serial_numbers =
          item.generated_serial_numbers.join("\n");
        console.log(
          `Using generated serial numbers for goods receiving item ${item.item_id}: ${serialNumberRecord.serial_numbers}`
        );
      }

      serialNumberRecords.push(serialNumberRecord);
    }
  }

  entry.table_sn_records = entry.table_sn_records.concat(serialNumberRecords);
};

const addEntry = async (organizationId, entry, putAwaySetupData) => {
  try {
    const prefixData = await getPrefixData(organizationId, "Goods Receiving");

    if (prefixData !== null) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId,
        "Goods Receiving"
      );

      await updatePrefix(organizationId, runningNumber, "Goods Receiving");

      entry.gr_no = prefixToShow;
    } else {
      const isUnique = await checkUniqueness(entry.gr_no, organizationId);
      if (!isUnique) {
        throw new Error(
          `GR Number "${entry.gr_no}" already exists. Please use a different number.`
        );
      }
    }

    const processedTableGr = [];
    for (const item of entry.table_gr) {
      const processedItem = await processRow(item, organizationId);
      processedTableGr.push(processedItem);
    }
    entry.table_gr = processedTableGr;

    await db.collection("goods_receiving").add(entry);

    await addInventory(entry, entry.plant_id, organizationId, putAwaySetupData);

    await createSerialNumberRecord(entry);

    // Find the created record and update it with serial number records
    const createdRecord = await db
      .collection("goods_receiving")
      .where({
        gr_no: entry.gr_no,
        organization_id: organizationId,
        plant_id: entry.plant_id,
      })
      .get();

    if (createdRecord.data && createdRecord.data.length > 0) {
      await db
        .collection("goods_receiving")
        .doc(createdRecord.data[0].id)
        .update({
          table_sn_records: entry.table_sn_records,
        });
    }

    const purchaseOrderIds = entry.po_id;

    const { po_data_array } = await updatePurchaseOrderStatus(
      purchaseOrderIds,
      entry.table_gr
    );

    const allNoItemCode = entry.table_gr.every((gr) => !gr.item_id);
    if (
      !putAwaySetupData ||
      (putAwaySetupData && putAwaySetupData.putaway_required === 0) ||
      allNoItemCode
    ) {
      await this.runWorkflow(
        "1917412667253141505",
        { gr_no: entry.gr_no, po_data: po_data_array },
        async (res) => {
          console.log("成功结果：", res);
        },
        (err) => {
          this.$message.error("Workflow execution failed");
          console.error("失败结果：", err);
          closeDialog();
        }
      );
    }

    this.$message.success("Add successfully");
    await closeDialog();
  } catch (error) {
    this.hideLoading();
    console.error(error);
    this.$message.error(error.message || String(error));
  }
};

const processRow = async (item, organizationId) => {
  if (item.item_batch_no === "Auto-generated batch number") {
    const resBatchConfig = await db
      .collection("batch_level_config")
      .where({ organization_id: organizationId })
      .get();

    if (resBatchConfig && resBatchConfig.data.length > 0) {
      const batchConfigData = resBatchConfig.data[0];
      let batchDate = "";
      let dd,
        mm,
        yy = "";

      // Checking for related field
      switch (batchConfigData.batch_format) {
        case "Document Date":
          let issueDate = this.getValue("gr_date");

          if (!issueDate)
            throw new Error(
              "Received Date is required for generating batch number."
            );

          console.log("issueDate", new Date(issueDate));

          issueDate = new Date(issueDate);

          dd = String(issueDate.getDate()).padStart(2, "0");
          mm = String(issueDate.getMonth() + 1).padStart(2, "0");
          yy = String(issueDate.getFullYear()).slice(-2);

          batchDate = dd + mm + yy;

          console.log("batchDate", batchDate);
          break;

        case "Document Created Date":
          let createdDate = new Date().toISOString().split("T")[0];

          console.log("createdDate", createdDate);

          createdDate = new Date(createdDate);

          dd = String(createdDate.getDate()).padStart(2, "0");
          mm = String(createdDate.getMonth() + 1).padStart(2, "0");
          yy = String(createdDate.getFullYear()).slice(-2);

          batchDate = dd + mm + yy;

          console.log("batchDate", batchDate);
          break;

        case "Manufacturing Date":
          let manufacturingDate = item.manufacturing_date;

          console.log("manufacturingDate", manufacturingDate);

          if (!manufacturingDate)
            throw new Error(
              "Manufacturing Date is required for generating batch number."
            );

          manufacturingDate = new Date(manufacturingDate);

          dd = String(manufacturingDate.getDate()).padStart(2, "0");
          mm = String(manufacturingDate.getMonth() + 1).padStart(2, "0");
          yy = String(manufacturingDate.getFullYear()).slice(-2);

          batchDate = dd + mm + yy;

          console.log("batchDate", batchDate);
          break;

        case "Expired Date":
          let expiredDate = item.expired_date;

          console.log("expiredDate", expiredDate);

          if (!expiredDate)
            throw new Error(
              "Expired Date is required for generating batch number."
            );

          expiredDate = new Date(expiredDate);

          dd = String(expiredDate.getDate()).padStart(2, "0");
          mm = String(expiredDate.getMonth() + 1).padStart(2, "0");
          yy = String(expiredDate.getFullYear()).slice(-2);

          batchDate = dd + mm + yy;

          console.log("batchDate", batchDate);
          break;
      }

      let batchPrefix = batchConfigData.batch_prefix || "";
      if (batchPrefix) batchPrefix += "-";

      const generatedBatchNo =
        batchPrefix +
        batchDate +
        String(batchConfigData.batch_running_number).padStart(
          batchConfigData.batch_padding_zeroes,
          "0"
        );

      item.item_batch_no = generatedBatchNo;
      await db
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

    return obj.toString();
  }
  return null;
};

const updateEntry = async (
  organizationId,
  entry,
  goodsReceivingId,
  putAwaySetupData
) => {
  try {
    const prefixData = await getPrefixData(organizationId, "Goods Receiving");

    if (prefixData !== null) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId,
        "Goods Receiving"
      );

      await updatePrefix(organizationId, runningNumber, "Goods Receiving");

      entry.gr_no = prefixToShow;
    } else {
      const isUnique = await checkUniqueness(entry.gr_no, organizationId);
      if (!isUnique) {
        throw new Error(
          `GR Number "${entry.gr_no}" already exists. Please use a different number.`
        );
      }
    }

    const processedTableGr = [];
    for (const item of entry.table_gr) {
      const processedItem = await processRow(item, organizationId);
      processedTableGr.push(processedItem);
    }
    entry.table_gr = processedTableGr;

    await db.collection("goods_receiving").doc(goodsReceivingId).update(entry);

    await addInventory(entry, entry.plant_id, organizationId, putAwaySetupData);

    await createSerialNumberRecord(entry);

    // Update the entry with serial number records
    await db.collection("goods_receiving").doc(goodsReceivingId).update({
      table_sn_records: entry.table_sn_records,
    });
    const purchaseOrderIds = entry.po_id;

    const { po_data_array } = await updatePurchaseOrderStatus(
      purchaseOrderIds,
      entry.table_gr
    );
    const allNoItemCode = entry.table_gr.every((gr) => !gr.item_id);
    if (
      !putAwaySetupData ||
      (putAwaySetupData && putAwaySetupData.putaway_required === 0) ||
      allNoItemCode
    ) {
      await this.runWorkflow(
        "1917412667253141505",
        { gr_no: entry.gr_no, po_data: po_data_array },
        async (res) => {
          console.log("成功结果：", res);
        },
        (err) => {
          this.$message.error("Workflow execution failed");
          console.error("失败结果：", err);
          closeDialog();
        }
      );
    }
    this.$message.success("Update successfully");
    await closeDialog();
  } catch (error) {
    this.hideLoading();
    this.$message.error(error);
  }
};

const fetchReceivedQuantity = async () => {
  const tableGR = this.getValue("table_gr") || [];

  const resPOLineData = await Promise.all(
    tableGR.map((item) =>
      db
        .collection("purchase_order_2ukyuanr_sub")
        .doc(item.po_line_item_id)
        .get()
    )
  );

  const poLineItemData = resPOLineData.map((response) => response.data[0]);

  const resItem = await Promise.all(
    tableGR
      .filter((item) => item.item_id !== null && item.item_id !== undefined)
      .map((item) => db.collection("Item").doc(item.item_id).get())
  );

  const itemData = resItem.map((response) => response.data[0]);

  const invalidReceivedQty = [];

  for (const [index, item] of tableGR.entries()) {
    const poLine = poLineItemData.find((po) => po.id === item.po_line_item_id);
    const itemInfo = itemData.find((data) => data.id === item.item_id);
    if (poLine) {
      const tolerance = itemInfo ? itemInfo.over_receive_tolerance || 0 : 0;
      const maxReceivableQty =
        ((poLine.quantity || 0) - (poLine.received_qty || 0)) *
        ((100 + tolerance) / 100);
      if ((item.received_qty || 0) > maxReceivableQty) {
        invalidReceivedQty.push(`#${index + 1}`);
        this.setData({
          [`table_gr.${index}.to_received_qty`]:
            (poLine.quantity || 0) - (poLine.received_qty || 0),
        });
      }
    }
  }

  if (invalidReceivedQty.length > 0) {
    await this.$alert(
      `Line${
        invalidReceivedQty.length > 1 ? "s" : ""
      } ${invalidReceivedQty.join(", ")} ha${
        invalidReceivedQty.length > 1 ? "ve" : "s"
      } an expected received quantity exceeding the maximum receivable quantity.`,
      "Invalid Received Quantity",
      {
        confirmButtonText: "OK",
        type: "error",
      }
    );

    throw new Error("Invalid received quantity detected.");
  }
};

const fillbackHeaderFields = async (entry) => {
  try {
    for (const [index, grLineItem] of entry.table_gr.entries()) {
      grLineItem.supplier_id = entry.supplier_name || null;
      grLineItem.organization_id = entry.organization_id;
      grLineItem.plant_id = entry.plant_id || null;
      grLineItem.billing_state_id = entry.billing_address_state || null;
      grLineItem.billing_country_id = entry.billing_address_country || null;
      grLineItem.shipping_state_id = entry.shipping_address_state || null;
      grLineItem.shipping_country_id = entry.shipping_address_country || null;
      grLineItem.assigned_to = entry.assigned_to || null;
      grLineItem.line_index = index + 1;
    }
    return entry.table_gr;
  } catch {
    throw new Error("Error processing goods receiving.");
  }
};

// Validate serial number allocation for serialized items
const validateSerialNumberAllocation = async (tableGR) => {
  const serializedItemsNotAllocated = [];

  for (const [index, item] of tableGR.entries()) {
    // Check if item is serialized but not allocated
    if (item.is_serialized_item === 1 && item.is_serial_allocated !== 1) {
      // Get item details for better error message
      let itemIdentifier =
        item.item_name ||
        item.item_code ||
        item.item_id ||
        `Item at row ${index + 1}`;
      serializedItemsNotAllocated.push({
        index: index + 1,
        identifier: itemIdentifier,
        item_id: item.item_id,
      });
    }
  }

  if (serializedItemsNotAllocated.length > 0) {
    const itemsList = serializedItemsNotAllocated
      .map((item) => `• Row ${item.index}: ${item.identifier}`)
      .join("\n");

    throw new Error(
      `Serial number allocation is required for the following serialized items:\n\n${itemsList}\n\nPlease allocate serial numbers for all serialized items before saving.`
    );
  }

  console.log(
    "Serial number allocation validation passed for all serialized items"
  );
  return true;
};

const processGRLineItem = async (entry) => {
  const totalQuantity = entry.table_gr.reduce((sum, item) => {
    const { received_qty } = item;
    return sum + (received_qty || 0); // Handle null/undefined received_qty
  }, 0);

  if (totalQuantity === 0) {
    throw new Error("Total return quantity is 0.");
  }

  const zeroQtyArray = [];
  for (const [index, gr] of entry.table_gr.entries()) {
    if (gr.received_qty <= 0) {
      zeroQtyArray.push(`#${index + 1}`);
    }
  }

  if (zeroQtyArray.length > 0) {
    await this.$confirm(
      `Line${zeroQtyArray.length > 1 ? "s" : ""} ${zeroQtyArray.join(", ")} ha${
        zeroQtyArray.length > 1 ? "ve" : "s"
      } a zero receive quantity, which may prevent processing.\nIf you proceed, it will delete the row with 0 receive quantity. \nWould you like to proceed?`,
      "Zero Receive Quantity Detected",
      {
        confirmButtonText: "OK",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: false,
      }
    )
      .then(async () => {
        console.log("User clicked OK");
        entry.table_gr = entry.table_gr.filter((item) => item.received_qty > 0);

        let poID = [];
        let purchaseOrderNumber = [];

        for (const gr of entry.table_gr) {
          poID.push(gr.line_po_id);
          purchaseOrderNumber.push(gr.line_po_no);
        }

        poID = [...new Set(poID)];
        purchaseOrderNumber = [...new Set(purchaseOrderNumber)];

        entry.po_id = poID;
        entry.po_no_display = purchaseOrderNumber.join(", ");

        return entry;
      })
      .catch(() => {
        // Function to execute when the user clicks "Cancel" or closes the dialog
        console.log("User clicked Cancel or closed the dialog");
        this.hideLoading();
        throw new Error("Saving goods receiving cancelled.");
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
      { name: "gr_no", label: "Good Receiving Number" },
      { name: "gr_date", label: "Received Date" },
      { name: "plant_id", label: "Plant" },
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

    for (const [index] of data.table_gr.entries()) {
      await this.validate(
        `table_gr.${index}.received_qty`,
        `table_gr.${index}.item_batch_no`
      );
    }

    const resPutAwaySetup = await db
      .collection("putaway_setup")
      .where({ plant_id: data.plant_id, movement_type: "Good Receiving" })
      .get();
    const putAwaySetupData = resPutAwaySetup?.data[0];

    const missingFields = await validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      const page_status = this.getValue("page_status");

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      if (putAwaySetupData.putaway_required === 1) {
        if (!data.assigned_to) {
          await this.$confirm(
            `Assigned To field is empty.\nIf you proceed, assigned person in putaway record will be empty. \nWould you like to proceed?`,
            "No Assigned Person Detected",
            {
              confirmButtonText: "OK",
              cancelButtonText: "Cancel",
              type: "warning",
              dangerouslyUseHTMLString: false,
            }
          ).catch(() => {
            console.log("User clicked Cancel or closed the dialog");
            this.hideLoading();
            throw new Error("Saving goods receiving cancelled.");
          });
        }
      }

      const {
        plant_id,
        currency_code,
        organization_id,
        purchase_order_number,
        po_id,
        gr_billing_address,
        gr_shipping_address,
        supplier_name,
        supplier_contact_person,
        supplier_contact_number,
        supplier_email,
        gr_no,
        gr_received_by,
        assigned_to,
        gr_date,
        table_gr,
        table_sn_records,
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
        billing_address_name,
        billing_address_phone,
        billing_attention,
        shipping_address_name,
        shipping_address_phone,
        shipping_attention,
        reference_doc,
        ref_no_1,
        ref_no_2,
        gr_remark1,
        gr_remark2,
        gr_remark3,
      } = data;
      const entry = {
        gr_status: "Received",
        po_id,
        plant_id,
        currency_code,
        organization_id,
        purchase_order_number,
        gr_billing_address,
        gr_shipping_address,
        supplier_name,
        supplier_contact_person,
        supplier_contact_number,
        supplier_email,
        gr_no,
        gr_received_by,
        assigned_to,
        gr_date,
        table_gr,
        table_sn_records,
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
        billing_address_name,
        billing_address_phone,
        billing_attention,
        shipping_address_name,
        shipping_address_phone,
        shipping_attention,
        reference_doc,
        ref_no_1,
        ref_no_2,
        gr_remark1,
        gr_remark2,
        gr_remark3,
      };

      const latestGR = await processGRLineItem(entry);

      if (latestGR.table_gr.length === 0) {
        throw new Error(
          "All Received Quantity must not be 0. Please add at lease one item with received quantity > 0."
        );
      }

      console.log(
        "Validating serial number allocation for serialized items..."
      );
      await validateSerialNumberAllocation(latestGR.table_gr);

      await fetchReceivedQuantity();
      await fillbackHeaderFields(latestGR);

      if (page_status === "Add") {
        await addEntry(organizationId, latestGR, putAwaySetupData);
      } else if (page_status === "Edit") {
        const goodsReceivingId = this.getValue("id");
        await updateEntry(
          organizationId,
          latestGR,
          goodsReceivingId,
          putAwaySetupData
        );
      }
    } else {
      this.hideLoading();
      this.$message.error(`Missing fields: ${missingFields.join(", ")}`);
    }
  } catch (error) {
    this.hideLoading();

    // Try to get message from standard locations first
    let errorMessage = "";

    if (error && typeof error === "object") {
      errorMessage = findFieldMessage(error) || error.toString();
    } else {
      errorMessage = error.toString() || error.message;
    }

    this.$message.error(errorMessage);
    console.error(errorMessage);
  }
})();
