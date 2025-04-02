const page_status = this.getParamsVariables("page_status");
const self = this;

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
  }
};

const updateInventory = (data) => {
  const items = data.table_prt;

  // Update FIFO inventory
  const updateFIFOInventory = (materialId, returnQty) => {
    // Get all FIFO records for this material sorted by sequence (oldest first)
    db.collection("fifo_costing_history")
      .where({ material_id: materialId })
      .get()
      .then((response) => {
        const result = response.data;

        if (result && Array.isArray(result) && result.length > 0) {
          // Sort by FIFO sequence (lowest/oldest first)
          const sortedRecords = result.sort(
            (a, b) => a.fifo_sequence - b.fifo_sequence
          );

          let remainingQtyToDeduct = parseFloat(returnQty);
          console.log(
            `Need to deduct ${remainingQtyToDeduct} units from FIFO inventory`
          );

          // Process each FIFO record in sequence until we've accounted for all delivery quantity
          for (const record of sortedRecords) {
            if (remainingQtyToDeduct <= 0) {
              break;
            }

            const availableQty = parseFloat(
              record.fifo_available_quantity || 0
            );
            console.log(
              `FIFO record ${record.fifo_sequence} has ${availableQty} available`
            );

            // Calculate how much to take from this record
            const qtyToDeduct = Math.min(availableQty, remainingQtyToDeduct);
            const newAvailableQty = availableQty - qtyToDeduct;

            console.log(
              `Deducting ${qtyToDeduct} from FIFO record ${record.fifo_sequence}, new available: ${newAvailableQty}`
            );

            // Update this FIFO record
            db.collection("fifo_costing_history")
              .doc(record.id)
              .update({
                fifo_available_quantity: newAvailableQty,
              })
              .catch((error) =>
                console.error(
                  `Error updating FIFO record ${record.fifo_sequence}:`,
                  error
                )
              );

            // Reduce the remaining quantity to deduct
            remainingQtyToDeduct -= qtyToDeduct;
          }

          if (remainingQtyToDeduct > 0) {
            console.warn(
              `Warning: Couldn't fully satisfy FIFO deduction. Remaining qty: ${remainingQtyToDeduct}`
            );
          }
        } else {
          console.warn(`No FIFO records found for material ${materialId}`);
        }
      })
      .catch((error) =>
        console.error(
          `Error retrieving FIFO history for material ${materialId}:`,
          error
        )
      );
  };

  if (Array.isArray(items)) {
    items.forEach((item, itemIndex) => {
      console.log(`Processing item ${itemIndex + 1}/${items.length}`);

      db.collection("inventory_movement")
        .add({
          transaction_type: "PRT",
          trx_no: data.purchase_return_no,
          parent_trx_no: item.gr_number,
          movement: "OUT",
          unit_price: item.unit_price,
          total_price: item.total_price,
          quantity: item.return_quantity,
          material_id: item.material_id,
          inventory_category: item.inv_category,
          uom_id: item.return_uom_id,
          base_uom_id: item.return_uom_id,
          bin_location_id: item.location_id,
          batch_number_id: item.batch_id,
          costing_method_id: item.costing_method,
        })
        .catch((error) => {
          console.error(
            `Error adding inventory_movement for item ${itemIndex + 1}:`,
            error
          );
        });

      const temporaryData = JSON.parse(item.temp_qty_data);
      console.log("Temporary data:", temporaryData);

      if (temporaryData.length > 0) {
        for (const temp of temporaryData) {
          const itemBalanceParams = {
            material_id: item.material_id,
            location_id: temp.location_id,
          };

          const categoryType = temp.inventory_category;
          const categoryValue = temp.return_quantity;

          if (temp.batch_id) {
            db.collection("item_batch_balance")
              .where(itemBalanceParams)
              .get()
              .then((response) => {
                const result = response.data;
                const hasExistingBalance =
                  result && Array.isArray(result) && result.length > 0;
                const existingDoc = hasExistingBalance ? result[0] : null;

                if (existingDoc && existingDoc.id) {
                  let updatedUnrestrictedQty = existingDoc.unrestricted_qty;
                  let updatedQualityInspectionQty = existingDoc.qualityinsp_qty;
                  let updatedBlockQty = existingDoc.block_qty;

                  if (categoryType === "UNR") {
                    updatedUnrestrictedQty -= categoryValue;
                  } else if (categoryType === "QIP") {
                    updatedQualityInspectionQty -= categoryValue;
                  } else if (categoryType === "BLK") {
                    updatedBlockQty -= categoryValue;
                  }

                  const updatedBalanceQty =
                    existingDoc.balance_quantity - categoryValue;

                  db.collection("item_batch_balance")
                    .doc(existingDoc.id)
                    .update({
                      unrestricted_qty: updatedUnrestrictedQty,
                      qualityinsp_qty: updatedQualityInspectionQty,
                      block_qty: updatedBlockQty,
                      balance_quantity: updatedBalanceQty,
                    });
                } else {
                  console.log("No existing item_batch_balance found");
                }

                updateFIFOInventory(item.material_id, temp.return_quantity);
              })
              .catch((error) =>
                console.error(
                  `Error updating item_batch_balance for item ${
                    itemIndex + 1
                  }:`,
                  error
                )
              );
          } else {
            db.collection("item_balance")
              .where(itemBalanceParams)
              .get()
              .then((response) => {
                const result = response.data;
                const hasExistingBalance =
                  result && Array.isArray(result) && result.length > 0;
                const existingDoc = hasExistingBalance ? result[0] : null;

                if (existingDoc && existingDoc.id) {
                  let updatedUnrestrictedQty = existingDoc.unrestricted_qty;
                  let updatedQualityInspectionQty = existingDoc.qualityinsp_qty;
                  let updatedBlockQty = existingDoc.block_qty;

                  if (categoryType === "UNR") {
                    updatedUnrestrictedQty -= categoryValue;
                  } else if (categoryType === "QIP") {
                    updatedQualityInspectionQty -= categoryValue;
                  } else if (categoryType === "BLK") {
                    updatedBlockQty -= categoryValue;
                  }

                  const updatedBalanceQty =
                    existingDoc.balance_quantity - categoryValue;

                  db.collection("item_balance").doc(existingDoc.id).update({
                    unrestricted_qty: updatedUnrestrictedQty,
                    qualityinsp_qty: updatedQualityInspectionQty,
                    block_qty: updatedBlockQty,
                    balance_quantity: updatedBalanceQty,
                  });
                } else {
                  console.log("No existing item_balance found");
                }

                updateFIFOInventory(item.material_id, temp.return_quantity);
              })
              .catch((error) =>
                console.error(
                  `Error querying item_balance for item ${itemIndex + 1}:`,
                  error
                )
              );
          }
        }
      }
    });
  }
};

this.getData()
  .then((data) => {
    const {
      purchase_return_no,
      purchase_order_id,
      goods_receiving_id,
      supplier_id,
      prt_billing_name,
      prt_billing_cp,
      prt_billing_address,
      prt_shipping_address,
      gr_date,
      plant,
      purchase_return_date,
      input_hvxpruem,
      return_delivery_method,
      purchase_return_ref,
      shipping_details,
      reason_for_return,
      driver_name,
      vehicle_no,
      driver_contact,
      pickup_date,
      courier_company,
      shipping_date,
      estimated_arrival,
      shipping_method,
      freight_charge,
      driver_name2,
      driver_contact_no2,
      estimated_arrival2,
      vehicle_no2,
      delivery_cost,
      table_prt,
      billing_address_line_1,
      billing_address_line_2,
      billing_address_line_3,
      billing_address_line_4,
      billing_address_city,
      billing_address_state,
      billing_address_country,
      billing_postal_code,
      shipping_address_line_1,
      shipping_address_line_2,
      shipping_address_line_3,
      shipping_address_line_4,
      shipping_address_city,
      shipping_address_state,
      shipping_address_country,
      shipping_postal_code,
    } = data;

    const prt = {
      purchase_return_status: "Issued",
      purchase_return_no,
      purchase_order_id,
      goods_receiving_id,
      supplier_id,
      prt_billing_name,
      prt_billing_cp,
      prt_billing_address,
      prt_shipping_address,
      gr_date,
      plant,
      purchase_return_date,
      input_hvxpruem,
      return_delivery_method,
      purchase_return_ref,
      shipping_details,
      reason_for_return,
      driver_name,
      vehicle_no,
      driver_contact,
      pickup_date,
      courier_company,
      shipping_date,
      estimated_arrival,
      shipping_method,
      freight_charge,
      driver_name2,
      driver_contact_no2,
      estimated_arrival2,
      vehicle_no2,
      delivery_cost,
      table_prt,
      billing_address_line_1,
      billing_address_line_2,
      billing_address_line_3,
      billing_address_line_4,
      billing_address_city,
      billing_address_state,
      billing_address_country,
      billing_postal_code,
      shipping_address_line_1,
      shipping_address_line_2,
      shipping_address_line_3,
      shipping_address_line_4,
      shipping_address_city,
      shipping_address_state,
      shipping_address_country,
      shipping_postal_code,
    };

    if (page_status === "Add") {
      db.collection("purchase_return_head")
        .add(prt)
        .then(() => {
          updateInventory(data);
        });
    } else if (page_status === "Edit") {
      const purchaseReturnId = this.getParamsVariables("purchase_return_no");
      db.collection("purchase_return_head")
        .doc(purchaseReturnId)
        .update(prt)
        .then(() => {
          updateInventory(data);
        });
    }
  })
  .then(() => {
    closeDialog();
  })
  .catch(() => {
    alert(
      "Please fill in all required fields marked with (*) before submitting."
    );
  });
