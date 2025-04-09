const page_status = this.getParamsVariables("page_status");
const self = this;

const addOnPO = async () => {
  try {
    const data = this.getValues();
    const items = data.table_po;

    if (!Array.isArray(items) || items.length === 0) {
      console.log("No items to process in table_po");
      return;
    }

    // Process items in parallel for better performance
    const promises = items.map(async (item, index) => {
      try {
        const itemRes = await db
          .collection("Item")
          .where({ id: item.item_id })
          .get();

        if (!itemRes.data || !itemRes.data.length) {
          console.error(`Item not found: ${item.item_id}`);
          return;
        }

        const itemData = itemRes.data[0];

        // UOM Conversion
        let altQty = parseFloat(item.quantity || 0);
        let baseQty = altQty;
        let altUOM = item.quantity_uom;
        let baseUOM = itemData.based_uom;

        if (
          Array.isArray(itemData.table_uom_conversion) &&
          itemData.table_uom_conversion.length > 0
        ) {
          console.log(`Checking UOM conversions for item ${item.item_id}`);

          const uomConversion = itemData.table_uom_conversion.find(
            (conv) => conv.alt_uom_id === altUOM
          );

          if (uomConversion) {
            console.log(
              `Found UOM conversion: 1 ${uomConversion.alt_uom_id} = ${uomConversion.base_qty} ${uomConversion.base_uom_id}`
            );

            baseQty = Math.round(altQty * uomConversion.base_qty * 1000) / 1000;

            console.log(
              `Converted ${altQty} ${altUOM} to ${baseQty} ${baseUOM}`
            );
          } else {
            console.log(`No conversion found for UOM ${altUOM}, using as-is`);
          }
        } else {
          console.log(
            `No UOM conversion table for item ${item.item_id}, using quantity as-is`
          );
        }

        const onOrderData = {
          purchase_order_number: data.purchase_order_no,
          material_id: item.item_id,
          material_name: item.item_id,
          purchase_order_line: index + 1,
          scheduled_qty: baseQty,
          open_qty: baseQty,
          received_qty: 0,
        };

        await db.collection("on_order_purchase_order").add(onOrderData);
        console.log(
          `Successfully added on_order_purchase_order for item ${index + 1}`
        );
      } catch (itemError) {
        console.error(`Error processing item ${index + 1}:`, itemError);
      }
    });

    await Promise.all(promises);
    console.log("All items processed for on_order_purchase_order");
  } catch (error) {
    console.error("Error in addOnPO function:", error);
  }
};

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
  }
};

this.getData().then((data) => {
  const {
    po_supplier_id,
    po_date,
    organization_id,
    po_currency,
    po_delivery_address,
    purchase_order_no,
    po_plant,
    po_receiving_supplier,
    po_billing_name,
    po_billing_cp,
    po_billing_address,
    po_shipping_address,
    po_payment_terms,
    po_expected_date,
    po_shipping_preference,
    po_ref_doc,
    table_po,
    po_total_gross,
    po_total_discount,
    po_total_tax,
    po_total,
    po_remark,
    po_tnc,
    billing_address_line_1,
    billing_address_line_2,
    billing_address_line_3,
    billing_address_line_4,
    billing_address_city,
    billing_postal_code,
    billing_address_state,
    billing_address_country,
    shipping_address_line_1,
    shipping_address_line_2,
    shipping_address_line_3,
    shipping_address_line_4,
    shipping_address_city,
    shipping_postal_code,
    shipping_address_state,
    shipping_address_country,
  } = data;

  const entry = {
    po_status: "Issued",
    purchase_order_no,
    po_supplier_id,
    po_date,
    organization_id,
    po_currency,
    po_delivery_address,
    po_plant,
    po_receiving_supplier,
    po_billing_name,
    po_billing_cp,
    po_billing_address,
    po_shipping_address,
    po_payment_terms,
    po_expected_date,
    po_shipping_preference,
    po_ref_doc,
    table_po,
    po_total_gross,
    po_total_discount,
    po_total_tax,
    po_total,
    po_remark,
    po_tnc,
    billing_address_line_1,
    billing_address_line_2,
    billing_address_line_3,
    billing_address_line_4,
    billing_address_city,
    billing_postal_code,
    billing_address_state,
    billing_address_country,
    shipping_address_line_1,
    shipping_address_line_2,
    shipping_address_line_3,
    shipping_address_line_4,
    shipping_address_city,
    shipping_postal_code,
    shipping_address_state,
    shipping_address_country,
  };

  if (page_status === "Add" || page_status === "Clone") {
    db.collection("purchase_order")
      .add(entry)
      .then(() => {
        return db
          .collection("prefix_configuration")
          .where({ document_types: "Purchase Orders", is_deleted: 0 })
          .get()
          .then((prefixEntry) => {
            const data = prefixEntry.data[0];
            return db
              .collection("prefix_configuration")
              .where({ document_types: "Purchase Orders", is_deleted: 0 })
              .update({ running_number: parseInt(data.running_number) + 1 });
          });
      })
      .then(() => {
        addOnPO();
        closeDialog();
      })
      .catch((error) => {
        alert(error);
      });
  } else if (page_status === "Edit") {
    let updatedPrefix = false;
    const purchaseOrderId = this.getParamsVariables("purchase_order_no");
    if (entry.purchase_order_no.startsWith("DRAFT")) {
      const prefixEntry = db
        .collection("prefix_configuration")
        .where({ document_types: "Purchase Orders", is_deleted: 0 })
        .get()
        .then((prefixEntry) => {
          if (prefixEntry) {
            const prefixData = prefixEntry.data[0];
            const now = new Date();
            let prefixToShow = prefixData.current_prefix_config;

            prefixToShow = prefixToShow.replace(
              "prefix",
              prefixData.prefix_value
            );
            prefixToShow = prefixToShow.replace(
              "suffix",
              prefixData.suffix_value
            );
            prefixToShow = prefixToShow.replace(
              "month",
              String(now.getMonth() + 1).padStart(2, "0")
            );
            prefixToShow = prefixToShow.replace(
              "day",
              String(now.getDate()).padStart(2, "0")
            );
            prefixToShow = prefixToShow.replace("year", now.getFullYear());
            prefixToShow = prefixToShow.replace(
              "running_number",
              String(prefixData.running_number).padStart(
                prefixData.padding_zeroes,
                "0"
              )
            );
            entry.purchase_order_no = prefixToShow;
            updatedPrefix = true;
            db.collection("purchase_order").doc(purchaseOrderId).update(entry);
            return prefixData.running_number;
          }
        })
        .then((currentRunningNumber) => {
          if (updatedPrefix) {
            db.collection("prefix_configuration")
              .where({ document_types: "Purchase Orders", is_deleted: 0 })
              .update({ running_number: parseInt(currentRunningNumber) + 1 });
          }
        })
        .then(() => {
          addOnPO();
          closeDialog();
        })
        .catch((error) => {
          console.log(error);
        });
    } else {
      db.collection("purchase_order")
        .doc(purchaseOrderId)
        .update(entry)
        .then(() => {
          addOnPO();
          closeDialog();
        })
        .catch((error) => {
          console.log(error);
        });
    }
  }
});
