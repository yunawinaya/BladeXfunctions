const data = this.getValues();
const purchaseReturnId = this.getParamsVariables("purchase_return_no");
let existingPRT = [];

// Check if data is ready and contains necessary information
const checkAndProcessData = () => {
  // If no data yet, try again after a short delay
  if (!data) {
    setTimeout(checkAndProcessData, 500);
    return;
  }

  // Get GR numbers from arguments
  const grNumbers = arguments[0].value;
  console.log("GR Numbers:", grNumbers);

  // Check if grNumbers is empty or invalid before proceeding
  if (!grNumbers || (Array.isArray(grNumbers) && grNumbers.length === 0)) {
    this.setData({
      table_prt: [],
      confirm_inventory: {
        table_item_balance: [],
      },
    });
    console.log("GR numbers is empty, skipping processing");
    return;
  }

  // Now call the main processing function
  processPurchaseReturn(grNumbers, purchaseReturnId);
};

// Main function to check for changes and load data
const processPurchaseReturn = async (grNumbers, purchaseReturnId) => {
  try {
    let hasGRChanged = true;
    let existingPRTData = null;

    // Check if this is an existing PRT and if GR selection has changed
    if (purchaseReturnId) {
      try {
        const result = await db
          .collection("purchase_return_head")
          .where({ id: purchaseReturnId })
          .get();

        if (result.data && result.data.length > 0) {
          existingPRTData = result.data[0];
          existingPRT = existingPRTData.table_prt || [];

          // Compare the existing GR list with the new one
          const existingGRs = existingPRTData.gr_ids
            ? JSON.parse(existingPRTData.gr_ids)
            : [];
          // Check if arrays are the same length and contain the same elements
          hasGRChanged =
            existingGRs.length !== grNumbers.length ||
            !existingGRs.every((gr) => grNumbers.includes(gr));

          console.log(`GR selection changed: ${hasGRChanged ? "Yes" : "No"}`);

          // If we're in Edit mode and GRs haven't changed, we can use existing data
          if (!hasGRChanged) {
            console.log("Using existing PRT data");
            console.log("Existing PRT:", existingPRT);
            this.setData({
              table_prt: existingPRT,
            });
            return; // Exit early as we're using existing data
          }
        } else {
          console.warn(
            "Purchase Return record not found with ID:",
            purchaseReturnId
          );
        }
      } catch (error) {
        console.error("Error checking existing purchase return:", error);
        // Continue as if GR has changed for safety
        hasGRChanged = true;
      }
    }

    // Only proceed with full data fetch if this is new or GR selection changed
    if (hasGRChanged) {
      // Fetch all GR data
      const promises = grNumbers.map((grNumber) => {
        return db
          .collection("goods_receiving")
          .where({ id: grNumber })
          .get()
          .then((result) => {
            // Extract GR data
            let grData = null;
            if (Array.isArray(result) && result.length > 0) {
              grData = result[0];
            } else if (typeof result === "object" && result !== null) {
              if (result.data) {
                grData =
                  Array.isArray(result.data) && result.data.length > 0
                    ? result.data[0]
                    : result.data;
              } else if (
                result.docs &&
                Array.isArray(result.docs) &&
                result.docs.length > 0
              ) {
                grData = result.docs[0].data
                  ? result.docs[0].data()
                  : result.docs[0];
              } else {
                grData = result;
              }
            }
            return { grNumber, grData };
          })
          .catch((error) => {
            console.error(`Error retrieving data for GR ${grNumber}:`, error);
            return { grNumber, grData: null };
          });
      });

      Promise.all(promises)
        .then(async (grDataResults) => {
          const allItems = [];

          // Process each GR record and treat each item as individual
          grDataResults.forEach((result) => {
            const { grNumber, grData } = result;
            if (!grData || !Array.isArray(grData.table_gr)) return;

            // Process each item in this GR individually
            grData.table_gr.forEach((item, itemIndex) => {
              const itemId = item.item_id;
              if (!itemId) return;

              // Create a new item entry for each item
              const newItem = {
                item_id: itemId,
                item_uom: item.item_uom,
                ordered_qty: item.ordered_qty,
                gr_date: grData.gr_date,
                received_qty: parseFloat(item.received_qty || 0),
                batch_number: item.item_batch_no,
                hasBatch: item.item_batch_no ? 1 : 0,
                unit_price: item.unit_price,
                total_price: item.total_price,
                gr_number: grData.gr_no,
                gr_line_item: itemIndex, // Store the line item index for reference
              };

              // Add location_id if it exists
              if (item.location_id) {
                newItem.location_id = item.location_id;
              }

              allItems.push(newItem);
            });
          });

          // Now fetch batch data for each item that has a batch number
          const batchPromises = allItems
            .filter((item) => item.batch_number)
            .map((item) => {
              return db
                .collection("batch")
                .where({ batch_number: item.batch_number })
                .get()
                .then((result) => {
                  if (result && result.data && result.data.length > 0) {
                    const batchData = result.data[0];
                    // Update the item with the batch ID
                    item.batch_id = batchData.id;
                  }
                  return item;
                })
                .catch((error) => {
                  console.error(
                    `Error retrieving batch data for ${item.batch_number}:`,
                    error
                  );
                  return item;
                });
            });

          // Wait for all batch queries to complete
          await Promise.all(batchPromises);

          // Sort the array: first group by material_id, then by hasBatch (items with batch first)
          allItems.sort((a, b) => {
            // First sort by material_id
            if (a.item_id < b.item_id) return -1;
            if (a.item_id > b.item_id) return 1;

            // If same material_id, sort by hasBatch (items with batch first)
            return b.hasBatch - a.hasBatch;
          });

          // Create table items with placeholders
          const tableItems = allItems.map((item, index) => {
            const tableItem = {
              material_id: item.item_id,
              material_desc: item.item_desc,
              return_uom_id: item.item_uom,
              gr_date: item.gr_date,
              received_qty: item.received_qty,
              unit_price: item.unit_price,
              total_price: item.total_price,
              gr_number: item.gr_number,
            };

            // Add batch_id and location_id if they exist
            if (item.batch_id) {
              tableItem.batch_id = item.batch_id;
            }

            if (item.location_id) {
              tableItem.location_id = item.location_id;
            }

            return { tableItem, item };
          });

          // Fetch balance quantities for all items with batch_id
          const balancePromises = tableItems
            .filter(({ item }) => item.batch_id)
            .map(({ tableItem, item }) => {
              return db
                .collection("item_batch_balance")
                .where({
                  material_id: item.item_id,
                  batch_id: item.batch_id,
                })
                .get()
                .then((result) => {
                  if (result && result.data && result.data.length > 0) {
                    const batchBalance = result.data[0];
                    if (batchBalance) {
                      tableItem.balance_quantity =
                        batchBalance.balance_quantity;
                    }
                  }
                  return tableItem;
                })
                .catch((error) => {
                  console.error(
                    `Error retrieving batch balance for ${item.batch_id}:`,
                    error
                  );
                  return tableItem;
                });
            });

          // Process items without batch_id to also fetch their balance
          const nonBatchBalancePromises = tableItems
            .filter(({ item }) => !item.batch_id)
            .map(({ tableItem, item }) => {
              return db
                .collection("item_balance")
                .where({
                  material_id: item.item_id,
                })
                .get()
                .then((result) => {
                  if (result && result.data && result.data.length > 0) {
                    const itemBalance = result.data[0];
                    if (itemBalance) {
                      tableItem.balance_quantity = itemBalance.balance_quantity;
                    }
                  }
                  return tableItem;
                })
                .catch((error) => {
                  console.error(
                    `Error retrieving item balance for ${item.item_id}:`,
                    error
                  );
                  return tableItem;
                });
            });

          // Wait for all balance queries to complete
          const batchItemsWithBalance = await Promise.all(balancePromises);
          const nonBatchItemsWithBalance = await Promise.all(
            nonBatchBalancePromises
          );

          // Combine both types of items and sort again
          const newTablePRT = [
            ...batchItemsWithBalance,
            ...nonBatchItemsWithBalance,
          ]
            .map((item) => {
              // Find matching item in existing PRT
              const existingItem = existingPRT.find(
                (ei) =>
                  ei.material_id === item.material_id &&
                  ei.gr_number === item.gr_number &&
                  (item.batch_id ? ei.batch_id === item.batch_id : true)
              );

              return {
                ...item,
                return_condition: existingItem?.return_condition || "",
              };
            })
            .sort((a, b) => {
              // Sort by material_id
              if (a.material_id < b.material_id) return -1;
              if (a.material_id > b.material_id) return 1;

              // If same material_id, batch items first
              const aBatch = a.batch_id ? 1 : 0;
              const bBatch = b.batch_id ? 1 : 0;
              return bBatch - aBatch;
            });

          console.log("existing Table PRT:", existingPRT);
          console.log("New Table PRT:", newTablePRT);

          // Update the form
          this.setData({
            table_prt: newTablePRT,
          });

          // Store the GR IDs for future comparison
          this.setData({
            gr_ids: JSON.stringify(grNumbers),
          });
        })
        .catch((error) => {
          console.error("Error processing GR data:", error);
        });
    }
  } catch (error) {
    console.error("Error in purchase return process:", error);
  }
};

// Start the process with a check for data readiness
checkAndProcessData();
