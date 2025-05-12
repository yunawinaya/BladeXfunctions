const plant = arguments[0]?.fieldModel?.item?.po_plant;
const organization = arguments[0]?.fieldModel?.item?.organization_id;
const page_status = this.getValue("page_status");

this.setData({
  plant_id: plant,
  organization_id: organization,
  currency_code: arguments[0].fieldModel.item.po_currency,
});

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

  const goodsReceivingId = this.getValue("id");

  // Now call the main processing function
  processGoodsReceiving(purchaseOrderId, goodsReceivingId);
};

// Main function to check PO change and load data
const processGoodsReceiving = async (purchaseOrderId, goodsReceivingId) => {
  try {
    let hasPOChanged = true;
    let existingGRData = null;
    let binLocation = "";
    const plantId = this.getValue("plant_id");
    if (plantId) {
      const resBinLocation = await db
        .collection("bin_location")
        .where({
          plant_id: plantId,
          is_default: true,
        })
        .get();

      binLocation = resBinLocation.data[0].id;
    } else {
      binLocation = "";
    }

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
      await this.setData({ table_gr: [] });
      // Get all existing goods receiving data for this purchase order
      const grResult = await db
        .collection("goods_receiving")
        .where({
          purchase_order_id: purchaseOrderId,
          gr_status: "Completed",
        })
        .get();

      const GRData = grResult.data || [];

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
      const itemPromises = sourceItems.map(async (sourceItem, rowIndex) => {
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

            const batchManagementEnabled =
              itemData.item_batch_management === 1 ||
              itemData.item_batch_management === true ||
              itemData.item_batch_management === "1";

            let batch_number = "";

            if (batchManagementEnabled) {
              batch_number = "";
            } else {
              batch_number = "-";
            }

            return {
              item_id: itemId,
              item_desc: sourceItem.item_desc || "",
              ordered_qty: orderedQty,
              to_received_qty: remainingQty,
              received_qty: 0,
              item_uom: sourceItem.quantity_uom || "",
              unit_price: sourceItem.unit_price || 0,
              total_price: sourceItem.po_amount || 0,
              location_id: binLocation,
              fm_key: stableKey,
              item_costing_method: itemData.material_costing_method,
              item_batch_no: batch_number,
              inv_category: "Unrestricted",
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
        unit_price: item.unit_price,
        total_price: item.total_price,
        location_id: binLocation,
        fm_key: item.fm_key,
        item_costing_method: item.item_costing_method,
        item_batch_no: item.item_batch_no,
        inv_category: "Unrestricted",
      }));

      console.log("Final table_gr data:", newTableGr);

      // Update the table once with all processed items
      await this.setData({
        table_gr: newTableGr,
      });

      setTimeout(() => {
        const table_gr = this.getValue("table_gr");
        table_gr.forEach((gr, index) => {
          const path = `table_gr.${index}.item_batch_no`;
          this.disabled(path, gr.item_batch_no !== "");
        });
      }, 100);
    } else {
      console.log("Skipping table_gr update as PO hasn't changed");
    }
    await processAddressInformation(purchaseOrderId);
  } catch (error) {
    console.error("Error in goods receiving process:", error);
  }
};

const formatAddress = (address, state, country) => {
  const addressComponents = [
    address.address_line_1,
    address.address_line_2,
    address.address_line_3,
    address.address_line_4,
    address.address_city,
    address.address_postal_code,
    state.state_name,
    country.country_name,
  ];

  return addressComponents
    .filter(Boolean)
    .join(",\n")
    .replace(/([^,])\n/g, "$1,\n");
};

// Extract address processing to a separate function
const processAddressInformation = async (purchaseOrderId) => {
  try {
    this.display("address_grid");

    // Reset address fields
    this.setData({
      gr_billing_name: "",
      gr_billing_cp: "",
      gr_billing_address: "",
      gr_shipping_address: "",
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

    // If not found, try from arguments
    supplierIdFromPO = arguments[0]?.fieldModel?.item?.po_supplier_id;

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
    } else {
      this.setData({
        supplier_contact_person: `${
          supplierData.contact_list[0].person_name || ""
        } ${supplierData.contact_list[0].person_last_name || ""}`.trim(),
        supplier_contact_number:
          supplierData.contact_list[0].phone_number || "",
        supplier_email: supplierData.contact_list[0].person_email || "",
      });
    }

    // Set supplier details
    this.setData({
      purchase_order_number: arguments[0]?.fieldModel?.item?.purchase_order_no,
      supplier_name: supplierData.id,
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
      Promise.all([
        db
          .collection("country")
          .where({ id: address.address_country_id })
          .get(),
        db.collection("state").where({ id: address.adddress_state }).get(),
      ]).then(([resCountry, resState]) => {
        const isShipping = address.address_purpose_id === shippingAddrId;
        const addressType = isShipping ? "shipping" : "billing";
        const country = resCountry.data[0];
        const state = resState.data[0];
        // Set address fields
        this.setData({
          [`${addressType}_address_line_1`]: address.address_line_1,
          [`${addressType}_address_line_2`]: address.address_line_2,
          [`${addressType}_address_line_3`]: address.address_line_3,
          [`${addressType}_address_line_4`]: address.address_line_4,
          [`${addressType}_address_city`]: address.address_city,
          [`${addressType}_address_state`]: state.id,
          [`${addressType}_postal_code`]: address.address_postal_code,
          [`${addressType}_address_country`]: country.id,
          [`gr_${addressType}_address`]: formatAddress(address, state, country),
        });

        // Set billing-specific fields
        if (addressType === "billing") {
          this.setData({
            gr_billing_name: address.address_name || "",
            gr_billing_cp: address.address_phone || "",
          });
        }
      });
    });
  } catch (error) {
    this.$message.error("Error processing address information:", error);
  }
};

// Start the process with a check for data readiness
checkAndProcessData();
