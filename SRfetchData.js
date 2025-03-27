const data = this.getValues();
console.log("Form data:", data);

// Get GD numbers from arguments
const gdNumbers = arguments[0].value;
console.log("GD Numbers:", gdNumbers);

// Check if gdNumbers is empty or invalid before proceeding
if (!gdNumbers || (Array.isArray(gdNumbers) && gdNumbers.length === 0)) {
  this.setData({ table_sr: [] });
  console.log("GD numbers is empty, skipping processing");
  return;
}

// Additional validation check to make sure gdNumbers is an array
if (!Array.isArray(gdNumbers)) {
  console.error("GD numbers is not an array:", gdNumbers);
  this.setData({ table_sr: [] });
  return;
}

// Fetch GD data
const promises = gdNumbers.map((gdNumber) => {
  return db
    .collection("goods_delivery")
    .where({
      id: gdNumber,
    })
    .get()
    .then((result) => {
      console.log(`Raw GD result for ${gdNumber}:`, result);

      // Handle GD result
      let gdData = null;

      if (Array.isArray(result) && result.length > 0) {
        gdData = result[0];
      } else if (typeof result === "object" && result !== null) {
        if (result.data) {
          gdData =
            Array.isArray(result.data) && result.data.length > 0
              ? result.data[0]
              : result.data;
        } else if (
          result.docs &&
          Array.isArray(result.docs) &&
          result.docs.length > 0
        ) {
          gdData = result.docs[0].data ? result.docs[0].data() : result.docs[0];
        } else {
          gdData = result;
        }
      }

      console.log(`Extracted GD data for ${gdNumber}:`, gdData);

      // Transform each GD item into a table_sr item, preserving GD identity
      const srItems = [];

      if (gdData && Array.isArray(gdData.table_gd)) {
        gdData.table_gd.forEach((gdItem) => {
          console.log(`Processing GD item from ${gdNumber}:`, gdItem);

          if (gdItem.material_id) {
            srItems.push({
              gd_number: gdNumber,
              material_id: gdItem.material_id,
              material_desc: gdItem.gd_material_desc,
              quantity_uom: gdItem.gd_order_uom_id,
              good_delivery_qty: gdItem.gd_delivered_qty,
              so_quantity: gdItem.gd_order_quantity,
            });
          }
        });
      }

      return srItems;
    })
    .catch((error) => {
      console.error(`Error retrieving data for GD ${gdNumber}:`, error);
      return [];
    });
});

Promise.all(promises)
  .then((allSrItemsArrays) => {
    // Flatten the array of arrays into a single array of all items
    const allSrItems = allSrItemsArrays.flat();

    console.log("All SR items (keeping separate GD entries):", allSrItems);

    // Set the table data directly - no consolidation
    this.setData({
      table_sr: allSrItems,
    });
  })
  .catch((error) => {
    console.error("Error processing GD numbers:", error);
    this.setData({ table_sr: [] });
  });
