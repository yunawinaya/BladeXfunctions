const data = this.getValues();
const items = data.table_gr;

if (Array.isArray(items)) {
  items.forEach((item, itemIndex) => {
    console.log(`Processing item ${itemIndex + 1}/${items.length}`);

    db.collection("goods_receiving_line")
      .add({
        goods_receiving_id: data.gr_no,
        material_id: item.item_id,
        order_quantity: item.ordered_qty,
        order_quantity_uom_id: item.item_uom,
        received_quantity: item.received_qty,
        to_receive_quantity: item.to_received_qty,
      })
      .catch((error) => {
        console.error(
          `Error adding goods_receiving_line for item ${itemIndex + 1}:`,
          error
        );
      });

    db.collection("inventory_movement")
      .add({
        transaction_type: "GRN",
        trx_no: data.gr_no,
        parent_trx_no: data.purchase_order_number,
        movement: "IN",
        unit_price: item.unit_price,
        total_price: item.total_price,
        quantity: item.received_qty,
        material_id: item.item_id,
      })
      .catch((error) => {
        console.error(
          `Error adding inventory_movement for item ${itemIndex + 1}:`,
          error
        );
      });

    db.collection("on_order_purchase_order")
      .where({
        purchase_order_number: data.purchase_order_number,
        material_id: item.item_id,
      })
      .get()
      .then((response) => {
        const result = response.data;
        if (result && Array.isArray(result) && result.length > 0) {
          const doc = result[0];
          if (doc && doc.id) {
            const orderedQty = parseFloat(item.ordered_qty || 0);
            const existingReceived = parseFloat(doc.received_qty || 0);
            const newReceived =
              existingReceived + parseFloat(item.received_qty || 0);
            const openQuantity = orderedQty - newReceived;

            db.collection("on_order_purchase_order").doc(doc.id).update({
              received_qty: newReceived,
              open_qty: openQuantity,
            });
          }
        }
      })
      .catch((error) => {
        console.error(
          `Error updating on_order_purchase_order for item ${itemIndex + 1}:`,
          error
        );
      });

    const itemBalanceParams = {
      material_id: item.item_id,
      location_id: item.location_id,
    };

    let block_qty = 0,
      reserved_qty = 0,
      unrestricted_qty = 0,
      qualityinsp_qty = 0;

    const receivedQty = parseFloat(item.received_qty || 0);

    if (item.inv_category === "BLK") {
      block_qty = receivedQty;
    } else if (item.inv_category === "RES") {
      reserved_qty = receivedQty;
    } else if (item.inv_category === "UNR") {
      unrestricted_qty = receivedQty;
    } else if (item.inv_category === "QIP") {
      qualityinsp_qty = receivedQty;
    } else {
      unrestricted_qty = receivedQty;
    }

    if (item.item_batch_no) {
      db.collection("batch")
        .add({
          batch_number: item.item_batch_no,
          material_id: item.item_id,
          initial_quantity: item.received_qty,
          goods_receiving_no: data.gr_no,
          goods_receiving_id: data.id || "",
        })
        .then(() => {
          db.collection("item_batch_balance")
            .where(itemBalanceParams)
            .get()
            .then((response) => {
              const result = response.data;
              const hasExistingBalance =
                result && Array.isArray(result) && result.length > 0;
              const existingDoc = hasExistingBalance ? result[0] : null;

              db.collection("batch")
                .where({
                  batch_number: item.item_batch_no,
                  material_id: item.item_id,
                })
                .get()
                .then((response) => {
                  const batchResult = response.data;
                  if (
                    batchResult &&
                    Array.isArray(batchResult) &&
                    batchResult.length > 0
                  ) {
                    const batchDoc = batchResult[0];
                    let balance_quantity;

                    if (existingDoc && existingDoc.id) {
                      const updatedBlockQty =
                        parseFloat(existingDoc.block_qty || 0) + block_qty;
                      const updatedReservedQty =
                        parseFloat(existingDoc.reserved_qty || 0) +
                        reserved_qty;
                      const updatedUnrestrictedQty =
                        parseFloat(existingDoc.unrestricted_qty || 0) +
                        unrestricted_qty;
                      const updatedQualityInspQty =
                        parseFloat(existingDoc.qualityinsp_qty || 0) +
                        qualityinsp_qty;

                      balance_quantity =
                        updatedBlockQty +
                        updatedReservedQty +
                        updatedUnrestrictedQty +
                        updatedQualityInspQty;

                      db.collection("item_batch_balance")
                        .doc(existingDoc.id)
                        .update({
                          batch_id: batchDoc.id,
                          block_qty: updatedBlockQty,
                          reserved_qty: updatedReservedQty,
                          unrestricted_qty: updatedUnrestrictedQty,
                          qualityinsp_qty: updatedQualityInspQty,
                          balance_quantity: balance_quantity,
                        });
                    } else {
                      balance_quantity =
                        block_qty +
                        reserved_qty +
                        unrestricted_qty +
                        qualityinsp_qty;

                      db.collection("item_batch_balance").add({
                        material_id: item.item_id,
                        location_id: item.location_id,
                        batch_id: batchDoc.id,
                        block_qty: block_qty,
                        reserved_qty: reserved_qty,
                        unrestricted_qty: unrestricted_qty,
                        qualityinsp_qty: qualityinsp_qty,
                        balance_quantity: balance_quantity,
                      });
                    }

                    db.collection("fifo_costing_history")
                      .where({ material_id: item.item_id })
                      .get()
                      .then((response) => {
                        const result = response.data;
                        const sequenceNumber =
                          result && Array.isArray(result) && result.length > 0
                            ? result.length + 1
                            : 1;

                        db.collection("fifo_costing_history").add({
                          fifo_cost_price: item.unit_price,
                          fifo_initial_quantity: item.received_qty,
                          fifo_available_quantity: item.received_qty,
                          material_id: item.item_id,
                          batch_id: batchDoc.id,
                          fifo_sequence: sequenceNumber,
                        });
                      })
                      .catch((error) =>
                        console.error(
                          `Error determining FIFO sequence for item ${
                            itemIndex + 1
                          }:`,
                          error
                        )
                      );
                  }
                })
                .catch((error) =>
                  console.error(
                    `Error fetching batch document for item ${itemIndex + 1}:`,
                    error
                  )
                );
            })
            .catch((error) =>
              console.error(
                `Error updating item_batch_balance for item ${itemIndex + 1}:`,
                error
              )
            );
        })
        .catch((error) =>
          console.error(`Error adding batch for item ${itemIndex + 1}:`, error)
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
              parseFloat(existingDoc.unrestricted_qty || 0) + unrestricted_qty;
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

            db.collection("item_balance")
              .add({
                material_id: item.item_id,
                location_id: item.location_id,
                block_qty: block_qty,
                reserved_qty: reserved_qty,
                unrestricted_qty: unrestricted_qty,
                qualityinsp_qty: qualityinsp_qty,
                balance_quantity: balance_quantity,
              })
              .catch((error) =>
                console.error(
                  `Error adding item_balance for item ${itemIndex + 1}:`,
                  error
                )
              );
          }

          db.collection("fifo_costing_history")
            .where({ material_id: item.item_id })
            .get()
            .then((response) => {
              const result = response.data;
              const sequenceNumber =
                result && Array.isArray(result) && result.length > 0
                  ? result.length + 1
                  : 1;

              db.collection("fifo_costing_history")
                .add({
                  fifo_cost_price: item.unit_price,
                  fifo_initial_quantity: item.received_qty,
                  fifo_available_quantity: item.received_qty,
                  material_id: item.item_id,
                  fifo_sequence: sequenceNumber,
                })
                .catch((error) =>
                  console.error(
                    `Error adding FIFO history for item ${itemIndex + 1}:`,
                    error
                  )
                );
            })
            .catch((error) =>
              console.error(
                `Error determining FIFO sequence for item ${itemIndex + 1}:`,
                error
              )
            );
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
