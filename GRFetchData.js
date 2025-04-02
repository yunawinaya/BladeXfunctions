const data = this.getValues();

// Check if purchase_order_id has a value
const purchaseOrderId = data.purchase_order_id;
if (!purchaseOrderId) {
  return;
}

// First, get all existing goods receiving data for this purchase order
db.collection("goods_receiving")
  .where({
    purchase_order_id: purchaseOrderId,
    gr_status: "Completed",
  })
  .get()
  .then((result) => {
    const GRData = result.data || [];
    this.setData({
      purchase_order_number: arguments[0]?.fieldModel?.item?.purchase_order_no,
    });
    // Get source items from the purchase order
    const sourceItems = arguments[0]?.fieldModel?.item?.table_po;
    if (!Array.isArray(sourceItems) || sourceItems.length === 0) {
      return;
    }

    // Calculate accumulated received quantities for each item
    const accumulatedQty = {};
    GRData.forEach((grRecord) => {
      if (Array.isArray(grRecord.table_gr)) {
        grRecord.table_gr.forEach((grItem) => {
          const itemId = grItem.item_id;
          if (itemId) {
            // Initialize if not exists
            if (!accumulatedQty[itemId]) {
              accumulatedQty[itemId] = 0;
            }
            // Add to accumulated quantity
            accumulatedQty[itemId] += parseFloat(grItem.received_qty || 0);
          }
        });
      }
    });

    try {
      // First, clear the existing array
      this.setData({
        table_gr: [],
      });

      // Create a better delay to ensure the clearing is complete
      setTimeout(() => {
        // Create the new items with proper structure including fm_key
        const newTableGr = sourceItems.map(() => ({
          item_id: "",
          item_desc: "",
          ordered_qty: "",
          to_received_qty: "",
          received_qty: 0,
          item_uom: "",
          unit_price: 0,
          total_price: 0,
          fm_key:
            Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        }));

        // Set the new array structure
        this.setData({
          table_gr: newTableGr,
        });

        // Use a longer delay to ensure the array is created
        setTimeout(() => {
          sourceItems.forEach((sourceItem, index) => {
            const itemId = sourceItem.item_id || "";
            const orderedQty = parseFloat(sourceItem.quantity || 0);

            // Calculate remaining quantity to receive
            const receivedSoFar = accumulatedQty[itemId] || 0;
            const remainingQty = Math.max(0, orderedQty - receivedSoFar);

            // Add item filtering logic here
            db.collection("item")
              .where({ id: itemId })
              .get()
              .then((res) => {
                const itemData = res.data[0];
                if (
                  itemData &&
                  itemData.stock_control !== 0 &&
                  itemData.show_receiving !== 0
                ) {
                  // Only update table if both conditions are met
                  this.setData({
                    [`table_gr.${index}.item_id`]: itemId,
                    [`table_gr.${index}.item_desc`]: sourceItem.item_desc || "",
                    [`table_gr.${index}.ordered_qty`]: orderedQty,
                    [`table_gr.${index}.to_received_qty`]: remainingQty,
                    [`table_gr.${index}.item_uom`]:
                      sourceItem.quantity_uom || "",
                    [`table_gr.${index}.base_uom_id`]:
                      sourceItem.quantity_uom || "",
                    [`table_gr.${index}.unit_price`]: sourceItem.unit_price,
                    [`table_gr.${index}.total_price`]: sourceItem.po_amount,
                  });

                  console.log(
                    `Item ${itemId}: Ordered=${orderedQty}, Received so far=${receivedSoFar}, Remaining=${remainingQty}`
                  );
                } else {
                  console.log(
                    `Skipping item ${itemId} due to stock_control or show_receiving settings`
                  );
                }
              })
              .catch((error) => {
                console.error(
                  `Error retrieving item data for ${itemId}:`,
                  error
                );
              });
          });
        }, 200);
      }, 100);
    } catch (e) {
      console.error("Error setting up table_gr:", e);
    }
  })
  .catch((error) => {
    console.error("Error retrieving data:", error);
  });

// Address
if (purchaseOrderId) {
  this.display("address_grid");
  const resetFormFields = () => {
    this.setData({
      gr_billing_name: "",
      gr_billing_cp: "",
      billing_address_line_1: "",
      billing_address_line_2: "",
      billing_address_line_3: "",
      billing_address_line_4: "",
      billing_address_city: "",
      billing_address_state: "",
      billing_postal_code: "",
      billing_address_country: "",
      shipping_address_line_1: "",
      shipping_address_line_2: "",
      shipping_address_line_3: "",
      shipping_address_line_4: "",
      shipping_address_city: "",
      shipping_address_state: "",
      shipping_postal_code: "",
      shipping_address_country: "",
    });
  };
  const setAddressFields = (addressType, address) => {
    this.setData({
      [`${addressType}_address_line_1`]: address.address_line_1,
      [`${addressType}_address_line_2`]: address.address_line_2,
      [`${addressType}_address_line_3`]: address.address_line_3,
      [`${addressType}_address_line_4`]: address.address_line_4,
      [`${addressType}_address_city`]: address.address_city,
      [`${addressType}_address_state`]: address.address_state,
      [`${addressType}_postal_code`]: address.address_postal_code,
      [`${addressType}_address_country`]: address.address_country,
    });
  };

  resetFormFields();

  const supplierIdFromPO = arguments[0]?.fieldModel?.item?.po_supplier_id;

  if (supplierIdFromPO) {
    Promise.all([
      db
        .collection("address_purpose")
        .where({ purpose_name: "Shipping" })
        .get(),
      db.collection("supplier_head").where({ id: supplierIdFromPO }).get(),
    ]).then(([resShipping, resSupplier]) => {
      if (resSupplier.data.length === 0 || resShipping.data.length === 0)
        return;

      const supplierData = resSupplier.data[0];
      const shippingAddrId = resShipping.data[0].id;

      const addresses = supplierData.address_list.filter(
        (address) => address.switch_save_as_default
      );

      this.setData({
        supplier_name: supplierData.id,
        supplier_contact_person:
          supplierData.contact_list[0].person_name +
          " " +
          supplierData.contact_list[0].person_last_name,
        supplier_contact_number: supplierData.contact_list[0].phone_number,
        supplier_email: supplierData.contact_list[0].person_email,
      });

      addresses.forEach((address) => {
        const isShipping = address.address_purpose_id === shippingAddrId;
        const addressType = isShipping ? "shipping" : "billing";

        setAddressFields(addressType, address);

        if (addressType === "billing") {
          this.setData({
            gr_billing_name: address.address_name,
            gr_billing_cp: address.address_phone,
          });
        }
      });
    });
  }
}
