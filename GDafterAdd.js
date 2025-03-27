const data = this.getValues();
const items = data.table_gd;

// Update FIFO inventory
const updateFIFOInventory = (materialId, deliveryQty) => {
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

        let remainingQtyToDeduct = parseFloat(deliveryQty);
        console.log(
          `Need to deduct ${remainingQtyToDeduct} units from FIFO inventory`
        );

        // Process each FIFO record in sequence until we've accounted for all delivery quantity
        for (const record of sortedRecords) {
          if (remainingQtyToDeduct <= 0) {
            break;
          }

          const availableQty = parseFloat(record.fifo_available_quantity || 0);
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
        transaction_type: "GDL",
        trx_no: data.delivery_no,
        parent_trx_no: data.so_no,
        movement: "OUT",
        unit_price: item.unit_price,
        total_price: item.total_price,
        quantity: item.gd_delivered_qty,
        material_id: item.material_id,
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

        const deliveredQty = parseFloat(item.gd_delivered_qty || 0);

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
                const updatedUnrestrictedQty =
                  parseFloat(existingDoc.unrestricted_qty || 0) -
                  temp.gd_quantity;

                const updatedBalanceQty =
                  existingDoc.balance_quantity - temp.gd_quantity;

                db.collection("item_batch_balance").doc(existingDoc.id).update({
                  unrestricted_qty: updatedUnrestrictedQty,
                  balance_quantity: updatedBalanceQty,
                });
              } else {
                console.log("No existing item_batch_balance found");
              }

              updateFIFOInventory(item.material_id, temp.gd_quantity);
            })
            .catch((error) =>
              console.error(
                `Error updating item_batch_balance for item ${itemIndex + 1}:`,
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
                const updatedUnrestrictedQty =
                  parseFloat(existingDoc.unrestricted_qty || 0) -
                  temp.gd_quantity;

                const updatedBalanceQty =
                  existingDoc.balance_quantity - temp.gd_quantity;

                db.collection("item_balance").doc(existingDoc.id).update({
                  unrestricted_qty: updatedUnrestrictedQty,
                  balance_quantity: updatedBalanceQty,
                });
              } else {
                console.log("No existing item_balance found");
              }

              updateFIFOInventory(item.material_id, temp.gd_quantity);
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
