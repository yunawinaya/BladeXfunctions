const data = this.getValues();
console.log("Form data:", data);

// Get Sales Return IDs from arguments
const salesReturnIDs = arguments[0].value;
console.log("Sales Return IDs:", salesReturnIDs);

// Display SR numbers nicely
Promise.all(
  salesReturnIDs.map((srId) =>
    db
      .collection("sales_return")
      .doc(srId) // Direct document reference
      .get()
      .then((doc) => (doc ? doc.data[0].sales_return_no : null))
  )
).then((results) => {
  const displayText = results.filter(Boolean).join(", ");
  console.log("sr", results);
  this.setData({ sr_no_display: displayText });
});

// Check if salesReturnIDs is empty or invalid before proceeding
if (
  !salesReturnIDs ||
  (Array.isArray(salesReturnIDs) && salesReturnIDs.length === 0)
) {
  this.setData({ table_srr: [] });
  console.log("Sales Return IDs is empty, skipping processing");
  return;
}

// Additional validation check to make sure salesReturnIDs is an array
if (!Array.isArray(salesReturnIDs)) {
  console.error("Sales Return IDs is not an array:", salesReturnIDs);
  this.setData({ table_srr: [] });
  return;
}

// Fetch existing SRRs for these Sales Returns to calculate remaining quantities
const fetchExistingSRRs = async (salesReturnIDs) => {
  try {
    const srrPromises = salesReturnIDs.map((srId) =>
      db.collection("sales_return_receiving").where({ sr_id: srId }).get()
    );

    const srrResults = await Promise.all(srrPromises);

    // Flatten and gather all SRR items
    let existingSrrItems = [];
    srrResults.forEach((result) => {
      if (result && result.data && result.data.length > 0) {
        result.data.forEach((srr) => {
          if (srr.table_srr && Array.isArray(srr.table_srr)) {
            existingSrrItems = [...existingSrrItems, ...srr.table_srr];
          }
        });
      }
    });

    console.log("Existing SRR items:", existingSrrItems);
    return existingSrrItems;
  } catch (error) {
    console.error("Error fetching existing SRRs:", error);
    return [];
  }
};

// Main processing function
(async () => {
  try {
    // Get all existing SRR items for these Sales Returns
    const existingSrrItems = await fetchExistingSRRs(salesReturnIDs);

    // Fetch SR data
    const promises = salesReturnIDs.map((salesReturnID) => {
      return db
        .collection("sales_return")
        .where({
          id: salesReturnID,
        })
        .get()
        .then((result) => {
          console.log(`Raw Sales Return result for ${salesReturnID}:`, result);

          // Handle Sales Return result
          let salesReturnData = null;

          if (Array.isArray(result) && result.length > 0) {
            salesReturnData = result[0];
          } else if (typeof result === "object" && result !== null) {
            if (result.data) {
              salesReturnData =
                Array.isArray(result.data) && result.data.length > 0
                  ? result.data[0]
                  : result.data;
            } else if (
              result.docs &&
              Array.isArray(result.docs) &&
              result.docs.length > 0
            ) {
              salesReturnData = result.docs[0].data
                ? result.docs[0].data()
                : result.docs[0];
            } else {
              salesReturnData = result;
            }
          }

          console.log(
            `Extracted Sales Return data for ${salesReturnID}:`,
            salesReturnData
          );

          // Transform each SR item into a table_srr item, preserving SR identity
          const srrItems = [];

          if (salesReturnData && Array.isArray(salesReturnData.table_sr)) {
            // Process each Sales Return item
            salesReturnData.table_sr.forEach((salesReturnItem, index) => {
              // Skip items without material ID
              if (!salesReturnItem.material_id) return;

              // Calculate how much has already been received for this SR item
              const alreadyReceivedQty = existingSrrItems
                .filter(
                  (item) =>
                    item.sr_number === salesReturnData.sales_return_no &&
                    item.material_id === salesReturnItem.material_id
                )
                .reduce(
                  (total, item) => total + (Number(item.return_quantity) || 0),
                  0
                );

              // Calculate remaining quantity to receive
              const expectedReturnQty =
                Number(salesReturnItem.expected_return_qty) || 0;
              const toReturnedQty = Math.max(
                0,
                expectedReturnQty - alreadyReceivedQty
              );

              // If nothing left to receive, skip this item
              if (toReturnedQty <= 0) return;

              let costingMethod = "";
              let targetLocation = "";

              // Setup for batch management and location defaults
              if (
                data.table_srr &&
                Array.isArray(data.table_srr) &&
                data.table_srr.length === 0
              ) {
                db.collection("Item")
                  .where({ id: salesReturnItem.material_id })
                  .get()
                  .then((result) => {
                    const itemData = result.data[0];
                    costingMethod = itemData.material_costing_method;

                    const plantId = this.getValue("plant_id");
                    console.log("plant", plantId);
                    db.collection("bin_location")
                      .where({
                        plant_id: plantId,
                        is_default: 1,
                      })
                      .get()
                      .then((resBinLocation) => {
                        if (resBinLocation.data.length > 0) {
                          targetLocation = resBinLocation.data[0].id;
                          this.setData({
                            [`table_srr.${index}.location_id`]: targetLocation,
                          });
                        }
                      });

                    const batchManagement = itemData.item_batch_management;

                    if (batchManagement === 1) {
                      this.disabled(`table_srr.${index}.batch_id`, false);
                    } else {
                      this.disabled(`table_srr.${index}.batch_id`, true);
                    }

                    db.collection("batch")
                      .where({ material_id: salesReturnItem.material_id })
                      .get()
                      .then((re) => {
                        if (re.data.length > 0) {
                          this.setOptionData(
                            `table_srr.${index}.batch_id`,
                            re.data
                          );
                        }
                      });
                  });
              }

              console.log(
                `Processing Sales Return item from ${salesReturnID}:`,
                salesReturnItem
              );

              // Add to SRR items
              srrItems.push({
                sr_id: salesReturnID,
                sr_number: salesReturnData.sales_return_no,
                material_id: salesReturnItem.material_id,
                material_name: salesReturnItem.material_name,
                receiving_detail: salesReturnItem.material_desc,
                line_so_no: salesReturnItem.line_so_no,
                so_quantity: salesReturnItem.so_quantity,
                expected_return_qty: salesReturnItem.expected_return_qty,
                to_returned_qty: toReturnedQty,
                return_quantity: toReturnedQty, // Default to max possible amount
                quantity_uom: salesReturnItem.quantity_uom,
                return_reason: salesReturnItem.return_reason,
                unit_price: salesReturnItem.unit_price,
                total_price: salesReturnItem.total_price,
                fifo_sequence: salesReturnItem.fifo_sequence,
                costing_method: costingMethod,
              });
            });
          }

          return srrItems;
        })
        .catch((error) => {
          console.error(
            `Error retrieving data for Sales Return ${salesReturnID}:`,
            error
          );
          return [];
        });
    });

    const allSrrItemsArrays = await Promise.all(promises);

    // Flatten the array of arrays into a single array of all items
    const allSrrItems = allSrrItemsArrays.flat();

    console.log(
      "All SRR items (keeping separate Sales Return entries):",
      allSrrItems
    );

    // Set the table data directly - no consolidation
    this.setData({
      table_srr: allSrrItems,
    });

    console.log(
      `Successfully processed ${allSrrItems.length} items from ${salesReturnIDs.length} Sales Returns`
    );
  } catch (error) {
    console.error("Error processing Sales Return IDs:", error);
    this.setData({ table_srr: [] });
  }
})();
