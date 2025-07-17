const previewFIFOSequences = (materialId, deliveryQty, callback) => {
  db.collection("fifo_costing_history")
    .where({ material_id: materialId })
    .get()
    .then((response) => {
      const result = response.data;
      const usedSequences = []; // Track which FIFO sequences would be used

      if (result && Array.isArray(result) && result.length > 0) {
        // Sort by FIFO sequence (lowest/oldest first)
        const sortedRecords = result.sort(
          (a, b) => a.fifo_sequence - b.fifo_sequence
        );

        let remainingQtyToDeduct = parseFloat(deliveryQty);
        console.log(
          `Need to deduct ${remainingQtyToDeduct} units from FIFO inventory for ${materialId}`
        );

        // Process each FIFO record in sequence
        for (const record of sortedRecords) {
          if (remainingQtyToDeduct <= 0) {
            break;
          }

          const availableQty = parseFloat(record.fifo_available_quantity || 0);

          // Calculate how much would be taken from this record
          const qtyToDeduct = Math.min(availableQty, remainingQtyToDeduct);

          // Add this sequence to our tracking array with the quantity that would be used
          if (qtyToDeduct > 0) {
            usedSequences.push({
              sequence: record.fifo_sequence,
              quantity: qtyToDeduct,
            });
          }

          // Reduce the remaining quantity to deduct
          remainingQtyToDeduct -= qtyToDeduct;
        }
      }

      // Create a formatted string of used sequences
      const fifoSequenceString = usedSequences
        .map((seq) => `${seq.sequence}(${seq.quantity})`)
        .join(", ");

      // Call the callback with the result
      callback(fifoSequenceString, usedSequences);
    })
    .catch((error) => {
      console.error(`Error previewing FIFO for ${materialId}:`, error);
      callback("Error checking FIFO", []);
    });
};

// Add this handler to your form elements
setTimeout(() => {
  const data = this.getValues();
  if (data.table_gd) {
    const rowIndex = arguments[0]?.rowIndex;
    const deliveredQty = arguments[0]?.value;

    if (rowIndex === undefined || !data.table_gd[rowIndex]) {
      console.log("Invalid row index or row not found");
      return;
    }

    const item = data.table_gd[rowIndex];
    const materialId = item.material_id;

    if (!materialId) {
      console.log("No material ID found for this item");
      return;
    }

    // Calculate undelivered quantity
    const orderQty = item.gd_order_quantity;
    const remainingQty = orderQty - deliveredQty;

    if (remainingQty >= 0) {
      this.setData({
        [`table_gd.${rowIndex}.gd_undelivered_qty`]: remainingQty,
      });
    }

    // If we have a valid delivered quantity, preview the FIFO sequences
    if (deliveredQty > 0) {
      previewFIFOSequences(materialId, deliveredQty, (fifoSequenceString) => {
        console.log(`FIFO sequences for ${materialId}: ${fifoSequenceString}`);
        this.setData({
          [`table_gd.${rowIndex}.fifo_sequence`]:
            fifoSequenceString || "No FIFO sequences available",
        });
      });
    } else {
      this.setData({
        [`table_gd.${rowIndex}.fifo_sequence`]: "",
      });
    }
  }
}, 300);
