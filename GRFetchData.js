// Check if data is ready and contains purchase_order_id
const checkAndProcessData = () => {
  const data = this.getValues();

  // If no data or purchase_order_id yet, try again after a short delay
  if (!data || !data.purchase_order_id) {
    setTimeout(checkAndProcessData, 500);
    return;
  }

  // Once we have the purchase_order_id, proceed with processing
  const purchaseOrderId = data.purchase_order_id;

  const goodsReceivingId = this.getParamsVariables("goods_receiving_no");

  // Now call the main processing function
  processGoodsReceiving(purchaseOrderId, goodsReceivingId);
};

// Main function to check PO change and load data
const processGoodsReceiving = async (purchaseOrderId, goodsReceivingId) => {
  try {
    let hasPOChanged = true;
    let existingGRData = null;

    // Check if this is an existing GR and if PO has changed
    if (goodsReceivingId) {
      try {
        const result = await db
          .collection("goods_receiving")
          .where({ id: goodsReceivingId })
          .get();

        if (result.data && result.data.length > 0) {
          existingGRData = result.data[0];
          hasPOChanged = existingGRData.purchase_order_id !== purchaseOrderId;
          console.log(`PO changed: ${hasPOChanged ? "Yes" : "No"}`);

          // If we're in Edit mode and have existing data, we'll use it for addresses
          if (!hasPOChanged) {
            console.log("Using existing GR data for addresses");
          }
        } else {
          console.warn(
            "Goods Receiving record not found with ID:",
            goodsReceivingId
          );
        }
      } catch (error) {
        console.error("Error checking existing goods receiving:", error);
        // Continue as if PO has changed for safety
        hasPOChanged = true;
      }
    }

    // Only proceed if this is a new record or PO has changed
    if (hasPOChanged) {
      // Get all existing goods receiving data for this purchase order
      const grResult = await db
        .collection("goods_receiving")
        .where({
          purchase_order_id: purchaseOrderId,
          gr_status: "Completed",
        })
        .get();

      const GRData = grResult.data || [];

      // Update purchase order number
      this.setData({
        purchase_order_number:
          arguments[0]?.fieldModel?.item?.purchase_order_no,
      });

      // Get source items from the purchase order
      const sourceItems = arguments[0]?.fieldModel?.item?.table_po;
      if (!Array.isArray(sourceItems) || sourceItems.length === 0) {
        console.warn("No source items found in purchase order");
        return;
      }

      // Calculate accumulated received quantities for each item
      const accumulatedQty = {};

      // First initialize quantities for all items
      sourceItems.forEach((item) => {
        if (item && item.item_id) {
          accumulatedQty[item.item_id] = 0;
        }
      });

      // Then accumulate from all GRs
      GRData.forEach((grRecord) => {
        if (Array.isArray(grRecord.table_gr)) {
          grRecord.table_gr.forEach((grItem) => {
            const itemId = grItem.item_id;
            if (itemId && accumulatedQty.hasOwnProperty(itemId)) {
              const qty = parseFloat(grItem.received_qty || 0);
              if (!isNaN(qty)) {
                accumulatedQty[itemId] += qty;
              }
            }
          });
        }
      });

      console.log("Accumulated quantities:", accumulatedQty);

      // Process all items concurrently
      const itemPromises = sourceItems.map(async (sourceItem) => {
        const itemId = sourceItem.item_id || "";
        if (!itemId) return null;

        try {
          const orderedQty = parseFloat(sourceItem.quantity || 0);
          const receivedSoFar = accumulatedQty[itemId] || 0;
          const remainingQty = Math.max(0, orderedQty - receivedSoFar);

          // Check item properties
          const res = await db.collection("Item").where({ id: itemId }).get();

          const itemData = res.data && res.data[0];

          if (
            itemData &&
            itemData.stock_control !== 0 &&
            (itemData.show_receiving !== 0 || !itemData.show_receiving)
          ) {
            // Generate a stable key to avoid unnecessary UI refreshes
            const stableKey = `${itemId}-${Date.now()
              .toString(36)
              .substr(0, 4)}`;

            return {
              item_id: itemId,
              item_desc: sourceItem.item_desc || "",
              ordered_qty: orderedQty,
              to_received_qty: remainingQty,
              received_qty: 0,
              item_uom: sourceItem.quantity_uom || "",
              base_uom_id: sourceItem.quantity_uom || "",
              unit_price: sourceItem.unit_price || 0,
              total_price: sourceItem.po_amount || 0,
              fm_key: stableKey,
            };
          }
          return null;
        } catch (error) {
          console.error(`Error processing item ${itemId}:`, error);
          return null;
        }
      });

      // Wait for all item processing to complete
      const processedItems = await Promise.all(itemPromises);
      const filteredItems = processedItems.filter((item) => item !== null);

      // Build the final table
      const newTableGr = filteredItems.map((item) => ({
        item_id: item.item_id,
        item_desc: item.item_desc,
        ordered_qty: item.ordered_qty,
        to_received_qty: item.to_received_qty,
        received_qty: item.received_qty,
        item_uom: item.item_uom,
        base_uom_id: item.base_uom_id,
        unit_price: item.unit_price,
        total_price: item.total_price,
        fm_key: item.fm_key,
      }));

      console.log("Final table_gr data:", newTableGr);

      // Update the table once with all processed items
      this.setData({
        table_gr: newTableGr,
      });
    } else {
      console.log("Skipping table_gr update as PO hasn't changed");
    }

    // Process address information (runs regardless of PO change)
    // If we have existing GR data, use it for addresses instead of looking it up again
    if (existingGRData) {
      await processExistingAddressInformation(existingGRData);
    } else {
      await processAddressInformation(purchaseOrderId);
    }
  } catch (error) {
    console.error("Error in goods receiving process:", error);
  }
};

// Process existing address information from GR data
const processExistingAddressInformation = async (grData) => {
  try {
    this.display("address_grid");

    // Use the existing GR data directly for addresses
    console.log("Setting address fields from existing GR data");

    this.setData({
      gr_billing_name: grData.gr_billing_name || "",
      gr_billing_cp: grData.gr_billing_cp || "",
      supplier_name: grData.supplier_name || "",
      supplier_contact_person: grData.supplier_contact_person || "",
      supplier_contact_number: grData.supplier_contact_number || "",
      supplier_email: grData.supplier_email || "",
      billing_address_line_1: grData.billing_address_line_1 || "",
      billing_address_line_2: grData.billing_address_line_2 || "",
      billing_address_line_3: grData.billing_address_line_3 || "",
      billing_address_line_4: grData.billing_address_line_4 || "",
      billing_address_city: grData.billing_address_city || "",
      billing_address_state: grData.billing_address_state || "",
      billing_postal_code: grData.billing_postal_code || "",
      billing_address_country: grData.billing_address_country || "",
      shipping_address_line_1: grData.shipping_address_line_1 || "",
      shipping_address_line_2: grData.shipping_address_line_2 || "",
      shipping_address_line_3: grData.shipping_address_line_3 || "",
      shipping_address_line_4: grData.shipping_address_line_4 || "",
      shipping_address_city: grData.shipping_address_city || "",
      shipping_address_state: grData.shipping_address_state || "",
      shipping_postal_code: grData.shipping_postal_code || "",
      shipping_address_country: grData.shipping_address_country || "",
    });
  } catch (error) {
    console.error("Error processing existing address information:", error);
  }
};

// Extract address processing to a separate function
const processAddressInformation = async (purchaseOrderId) => {
  try {
    this.display("address_grid");

    // Reset address fields
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

    // First try to get supplier_id from the form data
    let supplierIdFromPO = this.getValues().supplier_id;

    // If not found, try from arguments
    if (!supplierIdFromPO) {
      supplierIdFromPO = arguments[0]?.fieldModel?.item?.po_supplier_id;
    }

    // If still not found, try getting it from the PO directly
    if (!supplierIdFromPO) {
      try {
        console.log("Fetching PO to get supplier ID");
        const poResult = await db
          .collection("purchase_order")
          .where({ id: purchaseOrderId })
          .get();

        if (poResult.data && poResult.data.length > 0) {
          supplierIdFromPO = poResult.data[0].po_supplier_id;
        }
      } catch (error) {
        console.error("Error fetching PO for supplier ID:", error);
      }
    }

    if (!supplierIdFromPO) {
      console.warn(
        "No supplier ID found, unable to process address information"
      );
      return;
    }

    console.log("Using supplier ID for address:", supplierIdFromPO);

    // Get shipping purpose and supplier data concurrently
    const [resShipping, resSupplier] = await Promise.all([
      db
        .collection("address_purpose")
        .where({ purpose_name: "Shipping" })
        .get(),
      db.collection("supplier_head").where({ id: supplierIdFromPO }).get(),
    ]);

    if (
      !resSupplier.data ||
      !resSupplier.data.length ||
      !resShipping.data ||
      !resShipping.data.length
    ) {
      console.warn("Missing supplier or shipping purpose data");
      return;
    }

    const supplierData = resSupplier.data[0];
    const shippingAddrId = resShipping.data[0].id;

    // Check contact list exists
    if (!supplierData.contact_list || !supplierData.contact_list.length) {
      console.warn("Supplier has no contact information");
      return;
    }

    // Set supplier details
    this.setData({
      supplier_name: supplierData.id,
      supplier_contact_person: `${
        supplierData.contact_list[0].person_name || ""
      } ${supplierData.contact_list[0].person_last_name || ""}`.trim(),
      supplier_contact_number: supplierData.contact_list[0].phone_number || "",
      supplier_email: supplierData.contact_list[0].person_email || "",
    });

    // Process addresses
    const addresses =
      supplierData.address_list?.filter(
        (address) => address.switch_save_as_default
      ) || [];

    // If no addresses found, log a warning
    if (!addresses.length) {
      console.warn("No default addresses found for supplier");
      return;
    }

    console.log(`Found ${addresses.length} addresses for supplier`);

    addresses.forEach((address) => {
      const isShipping = address.address_purpose_id === shippingAddrId;
      const addressType = isShipping ? "shipping" : "billing";

      // Set address fields
      this.setData({
        [`${addressType}_address_line_1`]: address.address_line_1 || "",
        [`${addressType}_address_line_2`]: address.address_line_2 || "",
        [`${addressType}_address_line_3`]: address.address_line_3 || "",
        [`${addressType}_address_line_4`]: address.address_line_4 || "",
        [`${addressType}_address_city`]: address.address_city || "",
        [`${addressType}_address_state`]: address.address_state || "",
        [`${addressType}_postal_code`]: address.address_postal_code || "",
        [`${addressType}_address_country`]: address.address_country || "",
      });

      // Set billing-specific fields
      if (addressType === "billing") {
        this.setData({
          gr_billing_name: address.address_name || "",
          gr_billing_cp: address.address_phone || "",
        });
      }
    });
  } catch (error) {
    console.error("Error processing address information:", error);
  }
};

// Start the process with a check for data readiness
checkAndProcessData();
