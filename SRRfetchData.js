const data = this.getValues();
console.log("Form data:", data);

// Get GD numbers from arguments
const salesReturnIDs = arguments[0].value;
console.log("Sales Return IDs:", salesReturnIDs);

// Check if gdNumbers is empty or invalid before proceeding
if (
  !salesReturnIDs ||
  (Array.isArray(salesReturnIDs) && salesReturnIDs.length === 0)
) {
  this.setData({ table_srr: [] });
  console.log("Sales Return IDs is empty, skipping processing");
  return;
}

// Additional validation check to make sure gdNumbers is an array
if (!Array.isArray(salesReturnIDs)) {
  console.error("Sales Return IDs is not an array:", salesReturnIDs);
  this.setData({ table_srr: [] });
  return;
}

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
        salesReturnData.table_sr.forEach((salesReturnItem) => {
          console.log(
            `Processing Sales Return item from ${salesReturnID}:`,
            salesReturnItem
          );

          if (salesReturnItem.material_id) {
            srrItems.push({
              sr_number: salesReturnData.sales_return_no,
              material_id: salesReturnItem.material_id,
              so_quantity: salesReturnItem.so_quantity,
              expected_return_qty: salesReturnItem.expected_return_qty,
              quantity_uom: salesReturnItem.quantity_uom,
              return_reason: salesReturnItem.return_reason,
              unit_price: salesReturnItem.unit_price,
              total_price: salesReturnItem.total_price,
              fifo_sequence: salesReturnItem.fifo_sequence,
            });
          }
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

Promise.all(promises)
  .then((allSrrItemsArrays) => {
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
  })
  .catch((error) => {
    console.error("Error processing Sales Return IDs:", error);
    this.setData({ table_srr: [] });
  });
