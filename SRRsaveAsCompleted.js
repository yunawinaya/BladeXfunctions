const page_status = this.getParamsVariables("page_status");
const self = this;

const updateInventory = (data) => {
  const items = data.table_srr;

  if (Array.isArray(items)) {
    items.forEach((item, itemIndex) => {
      console.log(`Processing item ${itemIndex + 1}/${items.length}`);

      db.collection("inventory_movement")
        .add({
          transaction_type: "SRR",
          trx_no: data.srr_no,
          parent_trx_no: item.sr_number,
          movement: "IN",
          unit_price: item.unit_price,
          total_price: item.total_price,
          quantity: item.return_quantity,
          material_id: item.material_id,
          inventory_category: item.inventory_category,
          uom_id: item.quantity_uom,
          base_uom_id: item.quantity_uom,
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

      const itemBatchBalanceParams = {
        material_id: item.material_id,
        location_id: item.location_id,
        batch_id: item.batch_id,
      };

      const itemBalanceParams = {
        material_id: item.material_id,
        location_id: item.location_id,
      };

      let block_qty = 0,
        reserved_qty = 0,
        unrestricted_qty = 0,
        qualityinsp_qty = 0;

      const returnQty = parseFloat(item.return_quantity || 0);

      if (item.inventory_category === "BLK") {
        block_qty = returnQty;
      } else if (item.inventory_category === "RES") {
        reserved_qty = returnQty;
      } else if (item.inventory_category === "UNR") {
        unrestricted_qty = returnQty;
      } else if (item.inventory_category === "QIP") {
        qualityinsp_qty = returnQty;
      } else {
        unrestricted_qty = returnQty;
      }

      if (item.batch_id) {
        db.collection("item_batch_balance")
          .where(itemBatchBalanceParams)
          .get()
          .then((response) => {
            const result = response.data;
            const hasExistingBalance =
              result && Array.isArray(result) && result.length > 0;
            const existingDoc = hasExistingBalance ? result[0] : null;

            let balance_quantity;

            if (existingDoc && existingDoc.id) {
              const updatedBlockQty =
                parseFloat(existingDoc.block_qty || 0) + block_qty;
              const updatedReservedQty =
                parseFloat(existingDoc.reserved_qty || 0) + reserved_qty;
              const updatedUnrestrictedQty =
                parseFloat(existingDoc.unrestricted_qty || 0) +
                unrestricted_qty;
              const updatedQualityInspQty =
                parseFloat(existingDoc.qualityinsp_qty || 0) + qualityinsp_qty;

              balance_quantity =
                updatedBlockQty +
                updatedReservedQty +
                updatedUnrestrictedQty +
                updatedQualityInspQty;

              db.collection("item_batch_balance").doc(existingDoc.id).update({
                batch_id: item.batch_id,
                block_qty: updatedBlockQty,
                reserved_qty: updatedReservedQty,
                unrestricted_qty: updatedUnrestrictedQty,
                qualityinsp_qty: updatedQualityInspQty,
                balance_quantity: balance_quantity,
              });
            } else {
              balance_quantity =
                block_qty + reserved_qty + unrestricted_qty + qualityinsp_qty;

              db.collection("item_batch_balance").add({
                batch_id: item.batch_id,
                block_qty: block_qty,
                reserved_qty: reserved_qty,
                unrestricted_qty: unrestricted_qty,
                qualityinsp_qty: qualityinsp_qty,
                balance_quantity: balance_quantity,
              });
            }

            const fifoSequence =
              item.fifo_sequence && typeof item.fifo_sequence === "string"
                ? item.fifo_sequence.split("(")[0]
                : null;
            console.log("fifoSequence", fifoSequence);

            if (fifoSequence) {
              db.collection("fifo_costing_history")
                .where({
                  fifo_sequence: fifoSequence,
                  material_id: item.material_id,
                })
                .get()
                .then((response) => {
                  const result = response.data;
                  const fifoDoc =
                    result && Array.isArray(result) && result.length > 0
                      ? result[0]
                      : null;

                  if (fifoDoc && fifoDoc.id) {
                    const updatedAvailableQuantity =
                      parseFloat(fifoDoc.fifo_available_quantity || 0) +
                      returnQty;

                    db.collection("fifo_costing_history")
                      .doc(fifoDoc.id)
                      .update({
                        fifo_available_quantity: updatedAvailableQuantity,
                      });
                  }
                })
                .catch((error) =>
                  console.error(
                    `Error updating FIFO costing history for item ${
                      itemIndex + 1
                    }:`,
                    error
                  )
                );
            }
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

            let balance_quantity;

            if (existingDoc && existingDoc.id) {
              const updatedBlockQty =
                parseFloat(existingDoc.block_qty || 0) + block_qty;
              const updatedReservedQty =
                parseFloat(existingDoc.reserved_qty || 0) + reserved_qty;
              const updatedUnrestrictedQty =
                parseFloat(existingDoc.unrestricted_qty || 0) +
                unrestricted_qty;
              const updatedQualityInspQty =
                parseFloat(existingDoc.qualityinsp_qty || 0) + qualityinsp_qty;

              balance_quantity =
                updatedBlockQty +
                updatedReservedQty +
                updatedUnrestrictedQty +
                updatedQualityInspQty;

              db.collection("item_balance")
                .doc(existingDoc.id)
                .update({
                  block_qty: updatedBlockQty,
                  reserved_qty: updatedReservedQty,
                  unrestricted_qty: updatedUnrestrictedQty,
                  qualityinsp_qty: updatedQualityInspQty,
                  balance_quantity: balance_quantity,
                })
                .catch((error) =>
                  console.error(
                    `Error updating item_balance for item ${itemIndex + 1}:`,
                    error
                  )
                );
            } else {
              balance_quantity =
                block_qty + reserved_qty + unrestricted_qty + qualityinsp_qty;

              db.collection("item_balance").add({
                material_id: item.material_id,
                location_id: item.location_id,
                block_qty: block_qty,
                reserved_qty: reserved_qty,
                unrestricted_qty: unrestricted_qty,
                qualityinsp_qty: qualityinsp_qty,
                balance_quantity: balance_quantity,
              });
            }

            const fifoSequence =
              item.fifo_sequence && typeof item.fifo_sequence === "string"
                ? item.fifo_sequence.split("(")[0]
                : null;
            console.log("fifoSequence", fifoSequence);

            if (fifoSequence) {
              db.collection("fifo_costing_history")
                .where({
                  fifo_sequence: fifoSequence,
                  material_id: item.material_id,
                })
                .get()
                .then((response) => {
                  const result = response.data;
                  const fifoDoc =
                    result && Array.isArray(result) && result.length > 0
                      ? result[0]
                      : null;

                  if (fifoDoc && fifoDoc.id) {
                    const updatedAvailableQuantity =
                      parseFloat(fifoDoc.fifo_available_quantity || 0) +
                      returnQty;

                    db.collection("fifo_costing_history")
                      .doc(fifoDoc.id)
                      .update({
                        fifo_available_quantity: updatedAvailableQuantity,
                      });
                  }
                })
                .catch((error) =>
                  console.error(
                    `Error updating FIFO costing history for item ${
                      itemIndex + 1
                    }:`,
                    error
                  )
                );
            }
          })
          .catch((error) =>
            console.error(
              `Error querying item_balance for item ${itemIndex + 1}:`,
              error
            )
          );
      }
    });
  }
};

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
  }
};

this.getData()
  .then((data) => {
    const {
      so_id,
      sales_return_id,
      contact_person,
      srr_no,
      user_id,
      fileupload_ed0qx6ga,
      received_date,
      table_srr,
      input_y0dr1vke,
      remarks,
    } = data;

    const srr = {
      srr_status: "Completed",
      so_id,
      sales_return_id,
      contact_person,
      srr_no,
      user_id,
      fileupload_ed0qx6ga,
      received_date,
      table_srr,
      input_y0dr1vke,
      remarks,
    };

    if (page_status === "Add") {
      db.collection("sales_return_receiving")
        .add(srr)
        .then(() => {
          updateInventory(data);
        });
    } else if (page_status === "Edit") {
      const salesReturnReceivingId = this.getParamsVariables(
        "sales_return_receiving_no"
      );
      db.collection("sales_return_receiving")
        .doc(salesReturnReceivingId)
        .update(srr)
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
