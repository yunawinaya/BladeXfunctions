const id = this.getValue("goods_delivery_id");

async () => {
  try {
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

        // Function to get latest FIFO cost price with available quantity check
        const getLatestFIFOCostPrice = async (materialId, batchId) => {
          try {
            const query = batchId
              ? db
                  .collection("fifo_costing_history")
                  .where({ material_id: materialId, batch_id: batchId })
              : db
                  .collection("fifo_costing_history")
                  .where({ material_id: materialId });

            const response = await query.get();
            const result = response.data;

            if (result && Array.isArray(result) && result.length > 0) {
              // Sort by FIFO sequence (lowest/oldest first, as per FIFO principle)
              const sortedRecords = result.sort(
                (a, b) => a.fifo_sequence - b.fifo_sequence
              );

              // First look for records with available quantity
              for (const record of sortedRecords) {
                const availableQty = parseFloat(
                  record.fifo_available_quantity || 0
                );
                if (availableQty > 0) {
                  console.log(
                    `Found FIFO record with available quantity: Sequence ${record.fifo_sequence}, Cost price ${record.fifo_cost_price}`
                  );
                  return parseFloat(record.fifo_cost_price || 0);
                }
              }

              // If no records with available quantity, use the most recent record
              console.warn(
                `No FIFO records with available quantity found for ${materialId}, using most recent cost price`
              );
              return parseFloat(
                sortedRecords[sortedRecords.length - 1].fifo_cost_price || 0
              );
            }

            console.warn(`No FIFO records found for material ${materialId}`);
            return 0;
          } catch (error) {
            console.error(
              `Error retrieving FIFO cost price for ${materialId}:`,
              error
            );
            return 0;
          }
        };

        // Function to get Weighted Average cost price
        const getWeightedAverageCostPrice = async (materialId, batchId) => {
          try {
            const query = batchId
              ? db
                  .collection("wa_costing_method")
                  .where({ material_id: materialId, batch_id: batchId })
              : db
                  .collection("wa_costing_method")
                  .where({ material_id: materialId });

            const response = await query.get();
            const waData = response.data;

            if (waData && Array.isArray(waData) && waData.length > 0) {
              // Sort by date (newest first) to get the latest record
              waData.sort((a, b) => {
                if (a.created_at && b.created_at) {
                  return new Date(b.created_at) - new Date(a.created_at);
                }
                return 0;
              });

              return parseFloat(waData[0].wa_cost_price || 0);
            }

            console.warn(
              `No weighted average records found for material ${materialId}`
            );
            return 0;
          } catch (error) {
            console.error(
              `Error retrieving WA cost price for ${materialId}:`,
              error
            );
            return 0;
          }
        };

        const getFixedCostPrice = async (materialId) => {
          const query = db.collection("Item").where({ id: materialId });
          const response = await query.get();
          const result = response.data;
          return parseFloat(result[0].purchase_unit_price || 0);
        };

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
                // UOM Conversion
                let altQty = parseFloat(temp.gd_quantity);
                let baseQty = altQty;
                let altUOM = item.gd_order_uom_id;
                let baseUOM = itemData.based_uom;

                if (
                  Array.isArray(itemData.table_uom_conversion) &&
                  itemData.table_uom_conversion.length > 0
                ) {
                  console.log(
                    `Checking UOM conversions for item ${item.item_id}`
                  );

                  const uomConversion = itemData.table_uom_conversion.find(
                    (conv) => conv.alt_uom_id === altUOM
                  );

                  if (uomConversion) {
                    console.log(
                      `Found UOM conversion: 1 ${uomConversion.alt_uom_id} = ${uomConversion.base_qty} ${uomConversion.base_uom_id}`
                    );

                    baseQty =
                      Math.round(altQty * uomConversion.base_qty * 1000) / 1000;

                    console.log(
                      `Converted ${altQty} ${altUOM} to ${baseQty} ${baseUOM}`
                    );
                  } else {
                    console.log(
                      `No conversion found for UOM ${altUOM}, using as-is`
                    );
                  }
                } else {
                  console.log(
                    `No UOM conversion table for item ${item.item_id}, using received quantity as-is`
                  );
                }

                const costingMethod = itemData.material_costing_method;

                let unitPrice = item.unit_price;
                let totalPrice = item.unit_price * altQty;

                if (costingMethod === "First In First Out") {
                  // Get unit price from latest FIFO sequence
                  const fifoCostPrice = await getLatestFIFOCostPrice(
                    item.material_id,
                    temp.batch_id
                  );
                  unitPrice = fifoCostPrice;
                  totalPrice = fifoCostPrice * baseQty;
                } else if (costingMethod === "Weighted Average") {
                  // Get unit price from WA cost price
                  const waCostPrice = await getWeightedAverageCostPrice(
                    item.material_id,
                    temp.batch_id
                  );
                  unitPrice = waCostPrice;
                  totalPrice = waCostPrice * baseQty;
                } else if (costingMethod === "Fixed Cost") {
                  // Get unit price from Fixed Cost
                  const fixedCostPrice = await getFixedCostPrice(
                    item.material_id
                  );
                  unitPrice = fixedCostPrice;
                  totalPrice = fixedCostPrice * baseQty;
                } else {
                  return Promise.resolve();
                }

                // Create inventory_movement record
                const inventoryMovementDataUNR = {
                  transaction_type: "GDL",
                  trx_no: gdData.delivery_no,
                  parent_trx_no: gdData.so_no,
                  movement: "IN",
                  unit_price: unitPrice,
                  total_price: totalPrice,
                  quantity: altQty,
                  item_id: item.material_id,
                  inventory_category: "Unrestricted",
                  uom_id: altUOM,
                  base_qty: baseQty,
                  base_uom_id: baseUOM,
                  bin_location_id: temp.location_id,
                  batch_number_id: temp.batch_id ? temp.batch_id : null,
                  costing_method_id: item.item_costing_method,
                  plant_id: gdData.plant_id,
                  organization_id: gdData.organization_id,
                };

                const inventoryMovementDataRES = {
                  transaction_type: "GDL",
                  trx_no: gdData.delivery_no,
                  parent_trx_no: gdData.so_no,
                  movement: "OUT",
                  unit_price: unitPrice,
                  total_price: totalPrice,
                  quantity: altQty,
                  item_id: item.material_id,
                  inventory_category: "Reserved",
                  uom_id: altUOM,
                  base_qty: baseQty,
                  base_uom_id: baseUOM,
                  bin_location_id: temp.location_id,
                  batch_number_id: temp.batch_id ? temp.batch_id : null,
                  costing_method_id: item.item_costing_method,
                  plant_id: gdData.plant_id,
                  organization_id: gdData.organization_id,
                };

                await db
                  .collection("inventory_movement")
                  .add(inventoryMovementDataUNR);

                await db
                  .collection("inventory_movement")
                  .add(inventoryMovementDataRES);

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

        // ADDED: Handle on_reserved_gd cleanup
        try {
          console.log(
            "Cleaning up reserved goods records for delivery:",
            gdData.delivery_no
          );

          const reservedGoodsQuery = await db
            .collection("on_reserved_gd")
            .where({
              gd_no: gdData.delivery_no,
              organization_id: gdData.organization_id,
            })
            .get();

          if (reservedGoodsQuery.data && reservedGoodsQuery.data.length > 0) {
            console.log(
              `Found ${reservedGoodsQuery.data.length} reserved goods records to mark as deleted`
            );

            const updatePromises = reservedGoodsQuery.data.map((record) =>
              db.collection("on_reserved_gd").doc(record.id).update({
                is_deleted: 1,
              })
            );

            await Promise.all(updatePromises);
            console.log(
              "Successfully marked all reserved goods records as deleted"
            );
          } else {
            console.log("No reserved goods records found for this delivery");
          }
        } catch (error) {
          console.error("Error cleaning up reserved goods records:", error);
          alert("There was an error cleaning up reserved goods records.");
        }

        // Update goods delivery status
        await db.collection("goods_delivery").doc(id).update({
          gd_status: "Cancelled",
        });

        // Handle transfer order cancellation
        if (gdData.picking_status === "Created") {
          const toResult = await db
            .collection("transfer_order")
            .where({ gd_no: id })
            .get();

          if (toResult.data && toResult.data.length > 0) {
            const toData = toResult.data[0];
            const toId = toData.to_id;

            await db.collection("transfer_order").doc(toId).update({
              to_status: "Cancelled",
            });
          } else {
            console.warn("Transfer order not found for goods delivery:", id);
          }
        }

        console.log("Goods Delivery successfully cancelled");
        this.refresh();
      })
      .catch((error) => {
        console.error("Error in cancellation process:", error);
        alert("An error occurred during cancellation. Please try again.");
      });
  } catch (error) {
    console.error("Error in cancellation process:", error);
    alert("An error occurred during cancellation. Please try again.");
  }
};
