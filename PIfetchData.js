const data = this.getValues();
const purchaseOrderId = data.purchase_order_id;
console.log("Purchase Order ID:", purchaseOrderId);

// Get GR numbers from arguments
const grNumbers = arguments[0].value;
console.log("GR Numbers:", grNumbers);

// Check if grNumbers is empty or invalid before proceeding
if (!grNumbers || (Array.isArray(grNumbers) && grNumbers.length === 0)) {
  this.setData({ table_pi: [] });
  console.log("GR numbers is empty, skipping processing");
  return; // Exit early if grNumbers is empty
}

db.collection("purchase_order")
  .where({
    id: purchaseOrderId,
  })
  .get()
  .then((result) => {
    console.log("Raw PO result:", result);

    // Handle different possible result formats
    let POData = null;

    if (Array.isArray(result) && result.length > 0) {
      POData = result[0];
    } else if (typeof result === "object" && result !== null) {
      if (result.data) {
        POData =
          Array.isArray(result.data) && result.data.length > 0
            ? result.data[0]
            : result.data;
      } else if (
        result.docs &&
        Array.isArray(result.docs) &&
        result.docs.length > 0
      ) {
        POData = result.docs[0].data ? result.docs[0].data() : result.docs[0];
      } else {
        POData = result;
      }
    }

    console.log("Extracted PO data:", POData);

    // Additional validation check here to make sure grNumbers is an array
    if (!Array.isArray(grNumbers)) {
      console.error("GR numbers is not an array:", grNumbers);
      return;
    }

    let allGRData = [];

    const promises = grNumbers.map((grNumber) => {
      return db
        .collection("goods_receiving")
        .where({
          id: grNumber,
        })
        .get()
        .then((result) => {
          console.log(`Raw GR result for ${grNumber}:`, result);

          // Handle GR result with the same logic as PO result
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

          console.log(`Extracted GR data for ${grNumber}:`, grData);

          if (grData) {
            allGRData.push(grData);
          }
          return grData;
        })
        .catch((error) => {
          console.error(`Error retrieving data for GR ${grNumber}:`, error);
          return null;
        });
    });

    Promise.all(promises)
      .then(() => {
        console.log("All GR data:", allGRData);

        // Additional check to ensure we have GR data to process
        if (allGRData.length === 0) {
          console.log("No valid GR data found, skipping further processing");
          return;
        }

        const itemMap = {};

        // Process PO data first
        if (POData) {
          console.log("Processing PO data, table_po:", POData.table_po);

          // Try different properties that might contain the items
          const poItems = POData.table_po || POData.items || [];

          if (Array.isArray(poItems)) {
            poItems.forEach((poItem) => {
              console.log("Processing PO item:", poItem);
              const itemId = poItem.item_id;
              if (itemId) {
                itemMap[itemId] = {
                  item_id: itemId,
                  item_desc: poItem.item_desc || "",
                  item_uom: poItem.quantity_uom,
                  ordered_qty: poItem.quantity,
                  unit_price: poItem.unit_price,
                  amount: poItem.po_amount,
                  // Add additional fields from PO
                  discount: poItem.discount,
                  discount_uom: poItem.discount_uom,
                  tax_rate: poItem.tax_rate,
                  tax_preference: poItem.tax_preference,
                  tax_inclusive: poItem.tax_inclusive,
                  received_qty: 0,
                };
                console.log(`Added PO item ${itemId} to map:`, itemMap[itemId]);
              }
            });
          }
        }

        // Then process GR data to update received quantities
        allGRData.forEach((grRecord) => {
          console.log("Processing GR record, table_gr:", grRecord.table_gr);

          if (grRecord && Array.isArray(grRecord.table_gr)) {
            grRecord.table_gr.forEach((item) => {
              console.log("Processing GR item:", item);
              const itemId = item.item_id;

              if (!itemId) {
                return;
              }

              if (!itemMap[itemId]) {
                itemMap[itemId] = {
                  item_id: itemId,
                  item_uom: item.item_uom,
                  ordered_qty: item.ordered_qty,
                  received_qty: 0,
                };
                console.log(
                  `Created new item ${itemId} from GR data:`,
                  itemMap[itemId]
                );
              }

              const receivedQty = parseFloat(item.received_qty || 0);
              itemMap[itemId].received_qty += receivedQty;
              console.log(
                `Updated received qty for ${itemId} to ${itemMap[itemId].received_qty}`
              );
            });
          }
        });

        const consolidatedItems = Object.values(itemMap);
        console.log("Consolidated items:", consolidatedItems);

        const newTablePi = consolidatedItems.map((item) => ({
          material_id: item.item_id,
          quantity_uom: item.item_uom,
          order_qty: item.ordered_qty,
          received_qty: item.received_qty,
          order_unit_price: item.unit_price,
          item_desc: item.item_desc,
          order_discount: item.discount,
          discount_uom: item.discount_uom,
          inv_tax_rate_id: item.tax_rate,
          tax_preference: item.tax_preference,
          tax_inclusive: item.tax_inclusive,
        }));

        console.log("Final table_pi data:", newTablePi);
        this.setData({
          table_pi: newTablePi,
        });
      })
      .catch((error) => {
        console.error("Error processing GR numbers:", error);
      });
  })
  .catch((error) => {
    console.error("Error retrieving PO data:", error);
  });
