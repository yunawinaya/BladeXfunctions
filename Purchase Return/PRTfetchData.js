const data = this.getValues();
const purchaseReturnId = this.getValue("id");
let existingPRT = [];

const checkAndProcessData = () => {
  if (!data) {
    setTimeout(checkAndProcessData, 500);
    return;
  }

  const grNumbers = arguments[0].value;
  console.log("GR Numbers:", grNumbers);

  this.setData({
    table_prt: [],
    confirm_inventory: {
      table_item_balance: [],
    },
  });

  processPurchaseReturn(grNumbers, purchaseReturnId);
};

const processPurchaseReturn = async (grNumbers, purchaseReturnId) => {
  try {
    let hasGRChanged = true;
    let existingPRTData = null;

    if (purchaseReturnId) {
      try {
        const result = await db
          .collection("purchase_return_head")
          .where({ id: purchaseReturnId })
          .get();

        if (result.data && result.data.length > 0) {
          existingPRTData = result.data[0];
          existingPRT = existingPRTData.table_prt || [];
          const existingGRs = existingPRTData.gr_ids
            ? JSON.parse(existingPRTData.gr_ids)
            : [];

          hasGRChanged =
            existingGRs.length !== grNumbers.length ||
            !existingGRs.every((gr) => grNumbers.includes(gr));

          console.log(`GR selection changed: ${hasGRChanged ? "Yes" : "No"}`);

          if (!hasGRChanged) {
            console.log("Using existing PRT data");
            this.setData({ table_prt: existingPRT });
            return;
          }
        } else {
          console.warn(
            "Purchase Return record not found with ID:",
            purchaseReturnId
          );
        }
      } catch (error) {
        console.error("Error checking existing purchase return:", error);
        hasGRChanged = true;
      }
    }

    if (hasGRChanged) {
      // Process GR data with async/await
      const grDataResults = await Promise.all(
        grNumbers.map(async (grNumber) => {
          try {
            const result = await db
              .collection("goods_receiving")
              .where({ id: grNumber })
              .get();

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
          } catch (error) {
            console.error(`Error retrieving data for GR ${grNumber}:`, error);
            return { grNumber, grData: null };
          }
        })
      );

      // Process all items with proper async/await
      const allItems = [];

      for (const result of grDataResults) {
        const { grNumber, grData } = result;
        if (!grData || !Array.isArray(grData.table_gr)) continue;

        for (const [index, item] of grData.table_gr.entries()) {
          const itemId = item.item_id;
          if (!itemId) continue;

          try {
            const resItem = await db
              .collection("Item")
              .where({ id: itemId })
              .get();
            const itemData = resItem?.data[0];

            const newItem = {
              item_id: itemId,
              material_desc: item.item_desc,
              item_uom: item.item_uom,
              ordered_qty: item.ordered_qty,
              gr_date: grData.gr_date,
              received_qty: parseFloat(item.received_qty || 0),
              batch_number: item.item_batch_no,
              hasBatch: item.item_batch_no ? 1 : 0,
              unit_price: item.unit_price,
              total_price: item.total_price,
              gr_number: grData.gr_no,
              gr_line_item: index,
              costing_method: itemData?.material_costing_method,
            };

            if (item.location_id) {
              newItem.location_id = item.location_id;
            }

            allItems.push(newItem);
          } catch (error) {
            console.error(`Error processing item ${itemId}:`, error);
          }
        }
      }

      // Process batch data
      for (const item of allItems.filter((item) => item.batch_number)) {
        try {
          const result = await db
            .collection("batch")
            .where({ batch_number: item.batch_number })
            .get();
          if (result?.data?.length > 0) {
            item.batch_id = result.data[0].id;
          }
        } catch (error) {
          console.error(
            `Error retrieving batch data for ${item.batch_number}:`,
            error
          );
        }
      }

      // Sort items
      // allItems.sort((a, b) => {
      //   if (a.item_id < b.item_id) return -1;
      //   if (a.item_id > b.item_id) return 1;
      //   return b.hasBatch - a.hasBatch;
      // });

      // Create table items and fetch balances
      const tableItems = await Promise.all(
        allItems.map(async (item) => {
          const tableItem = {
            material_id: item.item_id,
            material_desc: item.material_desc,
            return_uom_id: item.item_uom,
            gr_date: item.gr_date,
            received_qty: item.received_qty,
            unit_price: item.unit_price,
            total_price: item.total_price,
            gr_number: item.gr_number,
            costing_method: item.costing_method,
          };

          if (item.batch_id) tableItem.batch_id = item.batch_id;
          if (item.location_id) tableItem.location_id = item.location_id;

          // Fetch balance quantity
          try {
            const collection = item.batch_id
              ? "item_batch_balance"
              : "item_balance";
            const query = item.batch_id
              ? { material_id: item.item_id, batch_id: item.batch_id }
              : { material_id: item.item_id };

            const result = await db.collection(collection).where(query).get();
            if (result?.data?.length > 0) {
              tableItem.balance_quantity = result.data[0].balance_quantity;
            }
          } catch (error) {
            console.error(
              `Error retrieving balance for item ${item.item_id}:`,
              error
            );
          }

          return tableItem;
        })
      );

      // Merge with existing PRT data
      // const newTablePRT = tableItems.map((item) => {
      //   const existingItem = existingPRT.find(
      //     (ei) =>
      //       ei.material_id === item.material_id &&
      //       ei.gr_number === item.gr_number &&
      //       (!item.batch_id || ei.batch_id === item.batch_id)
      //   );

      //   return {
      //     ...item,
      //     return_condition: existingItem?.return_condition || "",
      //   };
      // });
      // .sort((a, b) => {
      //   if (a.material_id < b.material_id) return -1;
      //   if (a.material_id > b.material_id) return 1;
      //   return (b.batch_id ? 1 : 0) - (a.batch_id ? 1 : 0);
      // });

      this.setData({
        table_prt: tableItems,
        gr_ids: JSON.stringify(grNumbers),
      });
    }
  } catch (error) {
    console.error("Error in purchase return process:", error);
  }
};

checkAndProcessData();
