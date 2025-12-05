(async () => {
  try {
    this.showLoading();
    const allListID = "custom_ezwb0qqp";

    let selectedRecords;

    selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (selectedRecords && selectedRecords.length > 0) {
      let goodsDeliveryData = selectedRecords.filter(
        (item) => item.gd_status === "Created"
      );

      if (goodsDeliveryData.length === 0) {
        this.$message.error(
          "Please select at least one created goods delivery."
        );
        throw new Error();
      }

      const goodsDeliveryNumbers = goodsDeliveryData.map(
        (item) => item.delivery_no
      );

      await this.$confirm(
        `You've selected ${
          goodsDeliveryNumbers.length
        } goods delivery(s) to cancel. <br> <strong>Goods Delivery Numbers:</strong> <br>${goodsDeliveryNumbers.join(
          ", "
        )} <br>Do you want to proceed?`,
        "Goods Delivery Cancellation",
        {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          type: "warning",
          dangerouslyUseHTMLString: true,
        }
      ).catch(() => {
        console.log("User clicked Cancel or closed the dialog");
        throw new Error();
      });

      for (const gdItem of goodsDeliveryData) {
        const id = gdItem.id;
        const items = gdItem.table_gd;

        try {
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

          // Helper function to update aggregated item_balance for batch and serialized items
          const updateAggregatedItemBalance = async (
            materialId,
            locationId,
            baseQty,
            gdItem
          ) => {
            const generalItemBalanceParams = {
              material_id: materialId,
              location_id: locationId,
              plant_id: gdItem.plant_id.id,
            };

            const generalBalanceQuery = await db
              .collection("item_balance")
              .where(generalItemBalanceParams)
              .get();

            if (
              generalBalanceQuery.data &&
              generalBalanceQuery.data.length > 0
            ) {
              const generalBalance = generalBalanceQuery.data[0];
              const currentGeneralUnrestrictedQty = parseFloat(
                generalBalance.unrestricted_qty || 0
              );
              const currentGeneralReservedQty = parseFloat(
                generalBalance.reserved_qty || 0
              );

              // Reverse the logic: move from reserved back to unrestricted
              const finalGeneralUnrestrictedQty =
                currentGeneralUnrestrictedQty + baseQty;
              const finalGeneralReservedQty = Math.max(
                0,
                currentGeneralReservedQty - baseQty
              );

              await db
                .collection("item_balance")
                .doc(generalBalance.id)
                .update({
                  unrestricted_qty: finalGeneralUnrestrictedQty,
                  reserved_qty: finalGeneralReservedQty,
                  updated_at: new Date(),
                });

              console.log(
                `Reversed item_balance for item ${materialId} at ${locationId}: ` +
                  `moved ${baseQty} from reserved to unrestricted (aggregated balance)`
              );
            } else {
              console.warn(
                `No item_balance record found for item ${materialId} at location ${locationId}`
              );
            }
          };

          if (gdItem.gd_status !== "Created") {
            console.log(
              `Goods delivery is not in Created status (current: ${gdItem.gd_status}), skipping inventory reversal`
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
                        Math.round((altQty / uomConversion.alt_qty) * 1000) /
                        1000;

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
                  const isSerializedItem =
                    itemData.serial_number_management === 1;

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
                    trx_no: gdItem.delivery_no,
                    parent_trx_no: gdItem.so_no,
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
                    plant_id: gdItem.plant_id.id,
                    organization_id: gdItem.organization_id,
                  };

                  const inventoryMovementDataRES = {
                    transaction_type: "GDL",
                    trx_no: gdItem.delivery_no,
                    parent_trx_no: gdItem.so_no,
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
                    plant_id: gdItem.plant_id.id,
                    organization_id: gdItem.organization_id,
                  };

                  await db
                    .collection("inventory_movement")
                    .add(inventoryMovementDataUNR);

                  await db
                    .collection("inventory_movement")
                    .add(inventoryMovementDataRES);

                  // Handle serialized items
                  if (isSerializedItem) {
                    console.log(
                      `Processing serialized item cancellation for ${item.material_id}, serial: ${temp.serial_number}`
                    );

                    if (!temp.serial_number) {
                      console.error(
                        `Serial number missing for serialized item ${item.material_id}`
                      );
                      continue;
                    }

                    // Update serial balance - move from reserved back to unrestricted
                    const serialBalanceParams = {
                      material_id: item.material_id,
                      serial_number: temp.serial_number,
                      plant_id: gdItem.plant_id.id,
                      organization_id: gdItem.organization_id,
                      location_id: temp.location_id,
                    };

                    if (temp.batch_id) {
                      serialBalanceParams.batch_id = temp.batch_id;
                    }

                    if (temp.location_id) {
                      serialBalanceParams.location_id = temp.location_id;
                    }

                    const serialBalanceQuery = await db
                      .collection("item_serial_balance")
                      .where(serialBalanceParams)
                      .get();

                    if (
                      serialBalanceQuery.data &&
                      serialBalanceQuery.data.length > 0
                    ) {
                      const serialBalance = serialBalanceQuery.data[0];
                      const currentUnrestricted = parseFloat(
                        serialBalance.unrestricted_qty || 0
                      );
                      const currentReserved = parseFloat(
                        serialBalance.reserved_qty || 0
                      );

                      // For cancellation, we expect quantity to be 1 for serialized items
                      const cancelQty = 1;

                      if (currentReserved >= cancelQty) {
                        await db
                          .collection("item_serial_balance")
                          .doc(serialBalance.id)
                          .update({
                            unrestricted_qty: currentUnrestricted + cancelQty,
                            reserved_qty: Math.max(
                              0,
                              currentReserved - cancelQty
                            ),
                            updated_at: new Date(),
                          });

                        console.log(
                          `Updated serial balance for ${temp.serial_number}: moved ${cancelQty} from reserved to unrestricted`
                        );
                      } else {
                        console.warn(
                          `Insufficient reserved quantity for serial ${temp.serial_number}. Available: ${currentReserved}, Requested: ${cancelQty}`
                        );
                      }

                      // Create serial movement records for both movements
                      try {
                        // First get the movement IDs that were just created
                        await new Promise((resolve) =>
                          setTimeout(resolve, 100)
                        );

                        const movementQuery = await db
                          .collection("inventory_movement")
                          .where({
                            transaction_type: "GDL",
                            trx_no: gdItem.delivery_no,
                            item_id: item.material_id,
                            bin_location_id: temp.location_id,
                            base_qty: baseQty,
                            plant_id: gdItem.plant_id.id,
                            organization_id: gdItem.organization_id,
                          })
                          .get();

                        if (
                          movementQuery.data &&
                          movementQuery.data.length >= 2
                        ) {
                          // Find the IN and OUT movements
                          const sortedMovements = movementQuery.data.sort(
                            (a, b) =>
                              new Date(b.create_time) - new Date(a.create_time)
                          );

                          const inMovement = sortedMovements.find(
                            (mov) => mov.movement === "IN"
                          );
                          const outMovement = sortedMovements.find(
                            (mov) => mov.movement === "OUT"
                          );

                          if (inMovement) {
                            await db.collection("inv_serial_movement").add({
                              inventory_movement_id: inMovement.id,
                              serial_number: temp.serial_number,
                              batch_id: temp.batch_id || null,
                              base_qty: 1,
                              base_uom: baseUOM,
                              plant_id: gdItem.plant_id.id,
                              organization_id: gdItem.organization_id,
                              created_at: new Date(),
                            });
                            console.log(
                              `Created IN serial movement for ${temp.serial_number}`
                            );
                          }

                          if (outMovement) {
                            await db.collection("inv_serial_movement").add({
                              inventory_movement_id: outMovement.id,
                              serial_number: temp.serial_number,
                              batch_id: temp.batch_id || null,
                              base_qty: 1,
                              base_uom: baseUOM,
                              plant_id: gdItem.plant_id.id,
                              organization_id: gdItem.organization_id,
                              created_at: new Date(),
                            });
                            console.log(
                              `Created OUT serial movement for ${temp.serial_number}`
                            );
                          }
                        } else {
                          console.warn(
                            `Could not find movement records for serial item ${item.material_id}`
                          );
                        }
                      } catch (serialError) {
                        console.error(
                          `Error creating serial movement records for ${temp.serial_number}:`,
                          serialError
                        );
                      }
                    } else {
                      console.warn(
                        `Serial balance not found for ${temp.serial_number}`
                      );
                    }

                    // ADDED: Also update item_balance for serialized items (aggregated quantities)
                    await updateAggregatedItemBalance(
                      item.material_id,
                      temp.location_id,
                      1, // For serialized items, quantity is always 1
                      gdItem
                    );

                    // Skip regular balance processing for serialized items
                    continue;
                  }

                  const itemBalanceParams = {
                    material_id: item.material_id,
                    location_id: temp.location_id,
                    plant_id: gdItem.plant_id.id,
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

                    // ADDED: For batch items, also update item_balance (aggregated balance across all batches)
                    if (
                      balanceCollection === "item_batch_balance" &&
                      temp.batch_id
                    ) {
                      await updateAggregatedItemBalance(
                        item.material_id,
                        temp.location_id,
                        baseQty,
                        gdItem
                      );
                    }
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
              gdItem.delivery_no
            );

            const reservedGoodsQuery = await db
              .collection("on_reserved_gd")
              .where({
                doc_no: gdItem.delivery_no,
                organization_id: gdItem.organization_id,
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
          await db
            .collection("goods_delivery")
            .doc(id)
            .update({
              gd_status: "Cancelled",
              ...(gdItem.picking_status ? { picking_status: "Cancelled" } : {}),
            });

          await db
            .collection("goods_delivery_fwii8mvb_sub")
            .where({ goods_delivery_id: id })
            .update({ picking_status: "Cancelled" });

          if (gdItem.picking_status) {
            const pickingFilter = new Filter().in("gd_no", [id]).build();

            const resPicking = await db
              .collection("transfer_order")
              .filter(pickingFilter)
              .get();

            if (resPicking && resPicking.data.length > 0) {
              console.log("resPicking", resPicking);
              const pickingList = resPicking.data;

              for (const pickingData of pickingList) {
                for (const pickingItem of pickingData.table_picking_items) {
                  if (pickingItem.gd_id === id) {
                    pickingItem.line_status = "Cancelled";
                  }
                }

                const isAllGDCancelled = pickingData.table_picking_items.every(
                  (item) => item.line_status === "Cancelled"
                );

                if (isAllGDCancelled) {
                  pickingData.to_status = "Cancelled";
                }

                console.log("pickingData", pickingData);

                await db
                  .collection("transfer_order")
                  .doc(pickingData.id)
                  .update({
                    table_picking_items: pickingData.table_picking_items,
                    to_status: pickingData.to_status,
                  });
              }
            }
          }

          for (const soItem of gdItem.so_id) {
            await db
              .collection("sales_order")
              .doc(soItem.id)
              .update({ gd_status: null });
          }

          console.log("Goods Delivery successfully cancelled");
        } catch (error) {
          console.error("Error in cancellation process:", error);
          alert("An error occurred during cancellation. Please try again.");
        }
      }
      this.$message.success("Goods Delivery cancelled successfully");
      this.hideLoading();
      this.refresh();
    } else {
      this.hideLoading();
      this.$message.error("Please select at least one record.");
    }
  } catch (error) {
    this.hideLoading();
    console.error(error);
  }
})();
