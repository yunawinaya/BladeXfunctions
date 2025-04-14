const id = this.getValue("purchase_order_id");
const po_no = this.getValue("purchase_order_no");

db.collection("on_order_purchase_order")
  .where({ purchase_order_number: po_no })
  .get()
  .then((result) => {
    if (
      result &&
      result.data &&
      Array.isArray(result.data) &&
      result.data.length > 0
    ) {
      console.log(
        `Found ${result.data.length} on_order_purchase_order records to mark as deleted`
      );

      const updatePromises = result.data.map((record) => {
        return db
          .collection("on_order_purchase_order")
          .doc(record.id)
          .update({ is_deleted: 1 })
          .then(() => {
            console.log(`Successfully marked record ${record.id} as deleted`);
            return true;
          })
          .catch((error) => {
            console.error(`Error updating record ${record.id}:`, error);
            return false;
          });
      });

      return Promise.all(updatePromises);
    } else {
      console.log("No on_order_purchase_order records found for this PO");
      return [];
    }
  })
  .then(() => {
    return db.collection("purchase_order").doc(id).update({
      po_status: "Cancelled",
    });
  })
  .then(() => {
    console.log(
      "Successfully cancelled PO and marked related records as deleted"
    );
    this.refresh();
  })
  .catch((error) => {
    console.error("Error cancelling PO:", error);
    alert(
      "An error occurred while cancelling the purchase order. Please try again."
    );
  });
