const data = this.getValues();
const salesOrderId = data.sales_order_id;
console.log("Sales Order ID:", salesOrderId);

// Get GR numbers from arguments
const gdNumbers = arguments[0].value;
console.log("GD Numbers:", gdNumbers);

// Check if grNumbers is empty or invalid before proceeding
if (!gdNumbers || (Array.isArray(gdNumbers) && gdNumbers.length === 0)) {
  this.setData({ table_si: [] });
  console.log("GD numbers is empty, skipping processing");
  return; // Exit early if grNumbers is empty
}

db.collection("sales_order")
  .where({
    id: salesOrderId,
  })
  .get()
  .then((result) => {
    console.log("Raw Sales Order result:", result);

    // Handle different possible result formats
    let SOData = null;

    if (Array.isArray(result) && result.length > 0) {
      SOData = result[0];
    } else if (typeof result === "object" && result !== null) {
      if (result.data) {
        SOData =
          Array.isArray(result.data) && result.data.length > 0
            ? result.data[0]
            : result.data;
      } else if (
        result.docs &&
        Array.isArray(result.docs) &&
        result.docs.length > 0
      ) {
        SOData = result.docs[0].data ? result.docs[0].data() : result.docs[0];
      } else {
        SOData = result;
      }
    }

    console.log("Extracted Sales Order data:", SOData);

    // Additional validation check here to make sure grNumbers is an array
    if (!Array.isArray(gdNumbers)) {
      console.error("GD numbers is not an array:", gdNumbers);
      return;
    }

    let allGDData = [];

    const promises = gdNumbers.map((gdNumber) => {
      return db
        .collection("goods_delivery")
        .where({
          id: gdNumber,
        })
        .get()
        .then((result) => {
          console.log(`Raw GD result for ${gdNumber}:`, result);

          // Handle GD result with the same logic as PO result
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
              gdData = result.docs[0].data
                ? result.docs[0].data()
                : result.docs[0];
            } else {
              gdData = result;
            }
          }

          console.log(`Extracted GD data for ${gdNumber}:`, gdData);

          if (gdData) {
            allGDData.push(gdData);
          }
          return gdData;
        })
        .catch((error) => {
          console.error(`Error retrieving data for GD ${gdNumber}:`, error);
          return null;
        });
    });

    Promise.all(promises)
      .then(() => {
        console.log("All GD data:", allGDData);

        // Additional check to ensure we have GD data to process
        if (allGDData.length === 0) {
          console.log("No valid GD data found, skipping further processing");
          return;
        }

        const itemMap = {};

        // Process PO data first
        if (SOData) {
          console.log("Processing SO data, table_so:", SOData.table_so);

          // Try different properties that might contain the items
          const soItems = SOData.table_so || SOData.items || [];

          if (Array.isArray(soItems)) {
            soItems.forEach((soItem) => {
              console.log("Processing SO item:", soItem);
              const itemId = soItem.item_name;
              if (itemId) {
                itemMap[itemId] = {
                  item_id: itemId,
                  item_desc: soItem.so_desc || "",
                  item_uom: soItem.so_item_uom,
                  ordered_qty: soItem.so_quantity,
                  unit_price: soItem.so_item_price,
                  amount: soItem.so_amount,
                  discount: soItem.so_discount,
                  discount_uom: soItem.so_discount_uom,
                  tax_rate: soItem.so_tax_percentage,
                  tax_preference: soItem.so_tax_preference,
                  tax_inclusive: soItem.so_tax_inclusive,
                };
                console.log(`Added SO item ${itemId} to map:`, itemMap[itemId]);
              }
            });
          }
        }

        // Then process GR data to update received quantities
        allGDData.forEach((gdRecord) => {
          console.log("Processing GD record, table_gd:", gdRecord.table_gd);

          if (gdRecord && Array.isArray(gdRecord.table_gd)) {
            gdRecord.table_gd.forEach((item) => {
              console.log("Processing GD item:", item);
              const itemId = item.item_id;

              if (!itemId) {
                return;
              }

              if (!itemMap[itemId]) {
                itemMap[itemId] = {
                  delivery_qty: 0,
                };
                console.log(
                  `Created new item ${itemId} from GD data:`,
                  itemMap[itemId]
                );
              }

              const deliveryQty = parseFloat(item.gd_qty || 0);
              itemMap[itemId].delivery_qty += deliveryQty;
              console.log(
                `Updated delivery qty for ${itemId} to ${itemMap[itemId].delivery_qty}`
              );
            });
          }
        });

        const consolidatedItems = Object.values(itemMap);
        console.log("Consolidated items:", consolidatedItems);

        const newTableSI = consolidatedItems.map((item) => ({
          material_id: item.item_id,
          material_desc: item.item_desc,
          so_order_quantity: item.item_uom,
          so_order_uom_id: item.ordered_qty,
          good_delivery_quantity: item.delivery_qty,
          unit_price: item.unit_price,
          si_discount: item.discount,
          si_discount_uom_id: item.discount_uom,
          si_tax_rate_id: item.tax_preference,
          tax_rate_percent: item.tax_rate,
          si_tax_inclusive: item.tax_inclusive,
        }));

        console.log("Final table_si data:", newTableSI);
        this.setData({
          table_si: newTableSI,
        });
      })
      .catch((error) => {
        console.error("Error processing GD numbers:", error);
      });
  })
  .catch((error) => {
    console.error("Error retrieving SO data:", error);
  });
