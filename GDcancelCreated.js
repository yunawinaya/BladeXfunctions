const id = this.getValue("goods_delivery_id");

db.collection("goods_delivery")
  .doc(id)
  .get()
  .then(async (result) => {
    if (!result.data) {
      console.error("Goods delivery not found:", id);
      return;
    }

    const gdData = result.data[0];
    const items = gdData.table_gd;

    if (gdData.gd_status !== "Created") {
      console.log(
        `Goods delivery is not in Created status (current: ${gdData.gd_status}), skipping inventory reversal`
      );
    } else {
      try {
        for (const item of items) {
          if (!item.material_id || !item.temp_qty_data) {
            console.warn(`Skipping item with missing data:`, item);
            continue;
          }

          const itemRes = await db
            .collection("Item")
            .where({ id: item.material_id })
            .get();

          if (!itemRes.data || !itemRes.data.length) {
            console.warn(`Item not found, skipping: ${item.material_id}`);
            continue;
          }

          const itemData = itemRes.data[0];
          if (itemData.stock_control === 0) {
            console.log(
              `Skipping non-stock controlled item: ${item.material_id}`
            );
            continue;
          }

          const temporaryData = JSON.parse(item.temp_qty_data);
          for (const temp of temporaryData) {
            let altQty = parseFloat(temp.gd_quantity);
            let baseQty = altQty;
            let altUOM = item.gd_order_uom_id;

            if (
              Array.isArray(itemData.table_uom_conversion) &&
              itemData.table_uom_conversion.length > 0
            ) {
              const uomConversion = itemData.table_uom_conversion.find(
                (conv) => conv.alt_uom_id === altUOM
              );

              if (uomConversion) {
                baseQty =
                  Math.round(altQty * uomConversion.base_qty * 1000) / 1000;
              }
            }

            const itemBalanceParams = {
              material_id: item.material_id,
              location_id: temp.location_id,
            };

            if (temp.batch_id) {
              itemBalanceParams.batch_id = temp.batch_id;
            }

            const balanceCollection = temp.batch_id
              ? "item_batch_balance"
              : "item_balance";

            const balanceQuery = await db
              .collection(balanceCollection)
              .where(itemBalanceParams)
              .get();

            const hasExistingBalance =
              balanceQuery.data &&
              Array.isArray(balanceQuery.data) &&
              balanceQuery.data.length > 0;

            if (hasExistingBalance) {
              const existingDoc = balanceQuery.data[0];

              await db
                .collection(balanceCollection)
                .doc(existingDoc.id)
                .update({
                  unrestricted_qty:
                    parseFloat(existingDoc.unrestricted_qty || 0) +
                    parseFloat(baseQty),
                  reserved_qty: Math.max(
                    0,
                    parseFloat(existingDoc.reserved_qty || 0) -
                      parseFloat(baseQty)
                  ),
                });

              console.log(
                `Reversed inventory for ${item.material_id} at location ${temp.location_id}: ${baseQty} units moved from reserved to unrestricted`
              );
            } else {
              console.warn(
                `Balance record not found for ${item.material_id} at location ${temp.location_id}`
              );
            }
          }
        }
        console.log("Successfully reversed all inventory transactions");
      } catch (error) {
        console.error("Error reversing inventory transactions:", error);
        alert(
          "There was an error cancelling some inventory transactions. Please check inventory levels."
        );
      }
    }

    return db.collection("goods_delivery").doc(id).update({
      gd_status: "Cancelled",
    });
  })
  .then(() => {
    console.log("Goods Delivery successfully cancelled");
    this.refresh();
  })
  .catch((error) => {
    console.error("Error in cancellation process:", error);
    alert("An error occurred during cancellation. Please try again.");
  });
