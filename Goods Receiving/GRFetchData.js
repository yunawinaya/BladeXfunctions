console.log("arguments", arguments[0]);
const page_status = this.getValue("page_status");

this.setData({
  currency_code: arguments[0].fieldModel[0].item.po_currency,
});

this.disabled("plant_id", false);

// Check if data is ready and contains purchase_order_id
const checkAndProcessData = () => {
  console.log("checkAndProcessData");
  const data = this.getValues();

  // If no data or purchase_order_id yet, try again after a short delay
  if (!data || !data.purchase_order_id) {
    setTimeout(checkAndProcessData, 500);
    return;
  }

  // Once we have the purchase_order_id, proceed with processing
  const purchaseOrderIds = Array.isArray(data.purchase_order_id)
    ? data.purchase_order_id
    : [data.purchase_order_id];

  const goodsReceivingId = this.getValue("id");

  // Now call the main processing function
  processGoodsReceiving(purchaseOrderIds, goodsReceivingId);
};

// Main function to check PO change and load data
const processGoodsReceiving = async (purchaseOrderIds, goodsReceivingId) => {
  try {
    console.log("Processing Purchase Order IDs:", purchaseOrderIds);

    let hasPOChanged = true;
    let existingGRData = null;

    // Check if this is an existing GR and if PO has changed
    if (goodsReceivingId) {
      try {
        const result = await db
          .collection("goods_receiving")
          .where({ id: goodsReceivingId })
          .get();

        if (result.data && result.data.length > 0) {
          existingGRData = result.data[0];

          // Check if PO list has changed
          const existingPOIds = Array.isArray(existingGRData.purchase_order_id)
            ? existingGRData.purchase_order_id
            : [existingGRData.purchase_order_id];

          // Check if arrays have same length and same elements (order doesn't matter)
          hasPOChanged =
            existingPOIds.length !== purchaseOrderIds.length ||
            !existingPOIds.every((id) => purchaseOrderIds.includes(id));

          console.log(`PO changed: ${hasPOChanged ? "Yes" : "No"}`);

          // If we're in Edit mode and have existing data, we'll use existing data
          if (!hasPOChanged) {
            console.log("Using existing GR data");
          }
        } else {
          console.warn(
            "Goods Receiving record not found with ID:",
            goodsReceivingId
          );
        }
      } catch (error) {
        console.error("Error checking existing goods receiving:", error);
        // Continue as if PO has changed for safety
        hasPOChanged = true;
      }
    }

    // Fetch all PO numbers for the multiple POs
    const poNumbersPromises = purchaseOrderIds.map(async (poId) => {
      try {
        const poResult = await db
          .collection("purchase_order")
          .where({ id: poId })
          .get();

        if (poResult.data && poResult.data.length > 0) {
          return poResult.data[0].purchase_order_no;
        }
        return null;
      } catch (error) {
        console.error(`Error fetching PO number for ${poId}:`, error);
        return null;
      }
    });

    const poNumbers = await Promise.all(poNumbersPromises);
    const validPoNumbers = poNumbers.filter(Boolean);

    // Set the combined PO numbers in purchase_order_number field
    if (validPoNumbers.length > 0) {
      this.setData({
        purchase_order_number: validPoNumbers.join(", "),
      });
    }

    // Only proceed if this is a new record or PO has changed
    if (hasPOChanged) {
      await this.setData({ table_gr: [] });

      // Build the final table items array
      let allGrItems = [];

      // Process each PO ID sequentially to ensure proper data handling
      for (const purchaseOrderId of purchaseOrderIds) {
        console.log(`Processing PO ID: ${purchaseOrderId}`);

        // Get all existing goods receiving data for this purchase order
        const grResult = await db
          .collection("goods_receiving")
          .where({
            purchase_order_id: purchaseOrderId,
            gr_status: "Completed",
          })
          .get();

        const GRData = grResult.data || [];

        // Get source items from the purchase order
        let sourceItems = [];
        let purchaseOrderNo = "";
        // Fetch PO data to get line items
        try {
          const poResult = await db
            .collection("purchase_order")
            .where({ id: purchaseOrderId })
            .get();

          if (poResult.data && poResult.data.length > 0) {
            sourceItems = poResult.data[0].table_po || [];
            purchaseOrderNo = poResult.data[0].purchase_order_no;
          } else {
            console.warn(`Purchase order with ID ${purchaseOrderId} not found`);
            continue; // Skip to next PO
          }
        } catch (error) {
          console.error(`Error fetching PO ${purchaseOrderId}:`, error);
          continue; // Skip to next PO
        }

        if (!Array.isArray(sourceItems) || sourceItems.length === 0) {
          console.warn(
            `No source items found in purchase order ${purchaseOrderId}`
          );
          continue; // Skip to next PO
        }

        // Calculate accumulated received quantities for each item
        const accumulatedQty = {};

        // First initialize quantities for all items
        sourceItems.forEach((item) => {
          if (item && item.item_id) {
            accumulatedQty[item.item_id] = 0;
          }
        });

        // Then accumulate from all GRs
        GRData.forEach((grRecord) => {
          if (Array.isArray(grRecord.table_gr)) {
            grRecord.table_gr.forEach((grItem) => {
              const itemId = grItem.item_id;
              if (itemId && accumulatedQty.hasOwnProperty(itemId)) {
                const qty = parseFloat(grItem.received_qty || 0);
                if (!isNaN(qty)) {
                  accumulatedQty[itemId] += qty;
                }
              }
            });
          }
        });

        console.log(
          `Accumulated quantities for PO ${purchaseOrderId}:`,
          accumulatedQty
        );

        // Process all items for this PO concurrently
        const itemPromises = sourceItems.map(async (sourceItem) => {
          const itemId = sourceItem.item_id || "";
          if (!itemId) return null;

          try {
            const orderedQty = parseFloat(sourceItem.quantity || 0);
            const receivedSoFar = accumulatedQty[itemId] || 0;
            const remainingQty = Math.max(0, orderedQty - receivedSoFar);

            // Check item properties
            const res = await db.collection("Item").where({ id: itemId }).get();

            const itemData = res.data && res.data[0];

            if (
              itemData &&
              itemData.stock_control !== 0 &&
              (itemData.show_receiving !== 0 || !itemData.show_receiving)
            ) {
              // Generate a stable key to avoid unnecessary UI refreshes
              const stableKey = `${purchaseOrderId}-${itemId}-${Date.now()
                .toString(36)
                .substr(0, 4)}`;

              const batchManagementEnabled =
                itemData.item_batch_management === 1 ||
                itemData.item_batch_management === true ||
                itemData.item_batch_management === "1";

              let batch_number = "";

              if (batchManagementEnabled) {
                batch_number = "";
              } else {
                batch_number = "-";
              }

              return {
                line_po_no: purchaseOrderNo,
                line_po_id: purchaseOrderId,
                item_id: itemId,
                item_desc: sourceItem.item_desc || "",
                ordered_qty: orderedQty,
                to_received_qty: remainingQty,
                received_qty: 0,
                item_uom: sourceItem.quantity_uom || "",
                unit_price: sourceItem.unit_price || 0,
                total_price: sourceItem.po_amount || 0,
                fm_key: stableKey,
                item_costing_method: itemData.material_costing_method,
                item_batch_no: batch_number,
                inv_category: "Unrestricted",
                po_id: purchaseOrderId, // Add PO ID for reference
                po_line_item:
                  sourceItem.line_item || sourceItem.po_line_item || null,
              };
            }

            return null;
          } catch (error) {
            console.error(
              `Error processing item ${itemId} from PO ${purchaseOrderId}:`,
              error
            );
            return null;
          }
        });

        // Wait for all item processing to complete for this PO
        const processedItems = await Promise.all(itemPromises);
        const filteredItems = processedItems.filter((item) => item !== null);

        // Add processed items from this PO to the all items array
        allGrItems = [...allGrItems, ...filteredItems];
      }

      // Build the final table
      const newTableGr = allGrItems.map((item) => ({
        line_po_no: item.line_po_no,
        line_po_id: item.line_po_id,
        item_id: item.item_id,
        item_desc: item.item_desc,
        ordered_qty: item.ordered_qty,
        to_received_qty: item.to_received_qty,
        received_qty: item.received_qty,
        item_uom: item.item_uom,
        unit_price: item.unit_price,
        total_price: item.total_price,
        fm_key: item.fm_key,
        item_costing_method: item.item_costing_method,
        item_batch_no: item.item_batch_no,
        inv_category: "Unrestricted",
        po_id: item.po_id, // Include PO reference
        po_line_item: item.po_line_item,
      }));

      console.log("Final table_gr data:", newTableGr);

      // Update the table once with all processed items
      await this.setData({
        table_gr: newTableGr,
      });

      setTimeout(() => {
        const table_gr = this.getValue("table_gr");
        table_gr.forEach((gr, index) => {
          const path = `table_gr.${index}.item_batch_no`;
          this.disabled(path, gr.item_batch_no !== "");
        });
      }, 100);
    } else {
      console.log("Skipping table_gr update as PO hasn't changed");
    }
  } catch (error) {
    console.error("Error in goods receiving process:", error);
  }
};

// Start the process with a check for data readiness
checkAndProcessData();
