(async () => {
  try {
    const data = this.getValues();
    console.log("Form data:", data);

    // Get GD numbers from arguments
    const gdNumbers = arguments[0].value;
    console.log("GD Numbers:", gdNumbers);

    // Check if gdNumbers is empty or invalid before proceeding
    if (!gdNumbers || (Array.isArray(gdNumbers) && gdNumbers.length === 0)) {
      this.setData({ table_sr: [], gd_no_display: "" });
      console.log("GD numbers is empty, skipping processing");
      return;
    }

    // Additional validation check to make sure gdNumbers is an array
    if (!Array.isArray(gdNumbers)) {
      console.error("GD numbers is not an array:", gdNumbers);
      this.setData({ table_sr: [], gd_no_display: [] });
      return;
    }

    // Display GD Numbers - fetch delivery numbers
    try {
      const gdDocsPromises = gdNumbers.map((gdId) =>
        db.collection("goods_delivery").doc(gdId).get()
      );

      const gdDocs = await Promise.all(gdDocsPromises);
      const gdDisplayResults = gdDocs
        .map((doc) =>
          doc && doc.data && doc.data.length > 0
            ? doc.data[0].delivery_no
            : null
        )
        .filter(Boolean);

      const displayText = gdDisplayResults.join(", ");
      console.log("GD display numbers:", gdDisplayResults);
      this.setData({ gd_no_display: displayText });
    } catch (error) {
      console.error("Error fetching GD display data:", error);
      this.setData({ gd_no_display: "" });
    }

    // Fetch existing sales returns for these GDs to calculate remaining return quantities
    let existingSalesReturns = [];
    try {
      // Create a query to fetch all sales returns for these GD numbers
      const salesReturnPromises = gdNumbers.map((gdId) =>
        db.collection("sales_return").where({ sr_return_gd_id: gdId }).get()
      );

      const salesReturnResults = await Promise.all(salesReturnPromises);

      // Flatten and process all sales return results
      salesReturnResults.forEach((result) => {
        if (result && result.data && result.data.length > 0) {
          result.data.forEach((sr) => {
            if (sr.table_sr && Array.isArray(sr.table_sr)) {
              existingSalesReturns = [...existingSalesReturns, ...sr.table_sr];
            }
          });
        }
      });

      console.log("Existing Sales Returns:", existingSalesReturns);
    } catch (error) {
      console.error("Error fetching existing sales returns:", error);
      // Continue processing even if we can't fetch existing returns
      existingSalesReturns = [];
    }

    // Process each GD sequentially to preserve exact order
    let finalSrItems = [];

    // Process each GD one by one to maintain exact order A B A B
    for (const gdNumber of gdNumbers) {
      try {
        const result = await db
          .collection("goods_delivery")
          .where({ id: gdNumber })
          .get();

        // Extract GD data safely
        let gdData = null;
        if (result && result.data && result.data.length > 0) {
          gdData = result.data[0];
        } else {
          console.warn(`No data found for GD ${gdNumber}`);
          continue; // Skip to next GD
        }

        console.log(`Processing GD ${gdNumber}: ${gdData.delivery_no}`);

        // Process each item in this GD
        if (gdData && Array.isArray(gdData.table_gd)) {
          const gdItems = gdData.table_gd
            .map((gdItem) => {
              if (!gdItem.material_id) return null;

              // Calculate total already returned quantity for this item
              const alreadyReturnedQty = existingSalesReturns
                .filter(
                  (sr) =>
                    sr.gd_id === gdNumber &&
                    sr.material_id === gdItem.material_id
                )
                .reduce(
                  (total, item) =>
                    total + (Number(item.expected_return_qty) || 0),
                  0
                );

              // Calculate to_returned_qty as the remaining quantity that can be returned
              const goodDeliveryQty = Number(gdItem.gd_qty) || 0;
              const toReturnQty = Math.max(
                0,
                goodDeliveryQty - alreadyReturnedQty
              );

              return {
                line_so_no: gdItem.line_so_no,
                line_so_id: gdItem.line_so_id,
                gd_number: gdData.delivery_no,
                gd_id: gdNumber,
                material_id: gdItem.material_id,
                material_name: gdItem.material_name,
                material_desc: gdItem.gd_material_desc,
                quantity_uom: gdItem.gd_order_uom_id,
                good_delivery_qty: goodDeliveryQty,
                to_returned_qty: toReturnQty,
                expected_return_qty: 0,
                so_quantity: gdItem.gd_order_quantity || 0,
                unit_price: gdItem.unit_price || 0,
                total_price: gdItem.total_price || 0,
                fifo_sequence: gdItem.fifo_sequence || "",
                return_remark: "",
              };
            })
            .filter(Boolean);

          // Add all items from this GD to the final array
          finalSrItems = [...finalSrItems, ...gdItems];
        }
      } catch (error) {
        console.error(`Error processing GD ${gdNumber}:`, error);
      }
    }

    console.log("Final SR items (preserving GD order):", finalSrItems);

    // Set the table data - items are now ordered exactly as their source GDs
    this.setData({
      table_sr: finalSrItems,
    });

    console.log(
      `Successfully processed ${finalSrItems.length} items from ${gdNumbers.length} GDs`
    );
  } catch (error) {
    console.error("Error in main processing:", error);
    this.setData({ table_sr: [], gd_no_display: "" });
  }
})();
