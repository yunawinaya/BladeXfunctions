const page_status = this.getParamsVariables("page_status");
const self = this;

const addOnPO = () => {
  const data = this.getValues();
  const items = data.table_po;
  if (Array.isArray(items)) {
    items.forEach((item, index) => {
      const onOrderData = {
        purchase_order_number: data.purchase_order_no,
        material_id: item.item_id,
        material_name: item.item_id,
        purchase_order_line: index + 1,
        scheduled_qty: item.quantity,
        open_qty: item.quantity,
        received_qty: 0,
      };

      db.collection("on_order_purchase_order")
        .add(onOrderData)
        .catch((error) => {
          console.log(
            `Error adding on_order_purchase_order for item ${index + 1}:`,
            error
          );
        });
    });
  } else {
    console.log("table_po is not an array:", items);
  }
};

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
    this.hideLoading();
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
    exchange_rate,
    myr_total_amount,
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
    exchange_rate,
    myr_total_amount,
  };

  if (page_status === "Add" || page_status === "Clone") {
    this.showLoading();
    db.collection("purchase_order")
      .add(entry)
      .then(() => {
        let organizationId = this.getVarGlobal("deptParentId");
        if (organizationId === "0") {
          organizationId = this.getVarSystem("deptIds").split(",")[0];
        }

        return db
          .collection("prefix_configuration")
          .where({
            document_types: "Purchase Orders",
            is_deleted: 0,
            organization_id: organizationId,
            is_active: 1,
          })
          .get()
          .then((prefixEntry) => {
            if (prefixEntry.data.length === 0) return;
            else {
              const data = prefixEntry.data[0];
              return db
                .collection("prefix_configuration")
                .where({
                  document_types: "Purchase Orders",
                  is_deleted: 0,
                  organization_id: organizationId,
                })
                .update({
                  running_number: parseInt(data.running_number) + 1,
                  has_record: 1,
                });
            }
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
    this.showLoading();
    const purchaseOrderId = this.getParamsVariables("purchase_order_no");
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    const prefixEntry = db
      .collection("prefix_configuration")
      .where({
        document_types: "Purchase Orders",
        is_deleted: 0,
        organization_id: organizationId,
        is_active: 1,
      })
      .get()
      .then((prefixEntry) => {
        if (prefixEntry.data.length > 0) {
          const prefixData = prefixEntry.data[0];
          const now = new Date();
          let prefixToShow;
          let runningNumber = prefixData.running_number;
          let isUnique = false;
          let maxAttempts = 10;
          let attempts = 0;

          const generatePrefix = (runNumber) => {
            let generated = prefixData.current_prefix_config;
            generated = generated.replace("prefix", prefixData.prefix_value);
            generated = generated.replace("suffix", prefixData.suffix_value);
            generated = generated.replace(
              "month",
              String(now.getMonth() + 1).padStart(2, "0")
            );
            generated = generated.replace(
              "day",
              String(now.getDate()).padStart(2, "0")
            );
            generated = generated.replace("year", now.getFullYear());
            generated = generated.replace(
              "running_number",
              String(runNumber).padStart(prefixData.padding_zeroes, "0")
            );
            return generated;
          };

          const checkUniqueness = async (generatedPrefix) => {
            const existingDoc = await db
              .collection("purchase_order")
              .where({ purchase_order_no: generatedPrefix })
              .get();
            return existingDoc.data[0] ? false : true;
          };

          const findUniquePrefix = async () => {
            while (!isUnique && attempts < maxAttempts) {
              attempts++;
              prefixToShow = generatePrefix(runningNumber);
              isUnique = await checkUniqueness(prefixToShow);
              if (!isUnique) {
                runningNumber++;
              }
            }

            if (!isUnique) {
              throw new Error(
                "Could not generate a unique Purchase Requisition number after maximum attempts"
              );
            } else {
              entry.purchase_order_no = prefixToShow;
              db.collection("purchase_order")
                .doc(purchaseOrderId)
                .update(entry);
              db.collection("prefix_configuration")
                .where({
                  document_types: "Purchase Orders",
                  is_deleted: 0,
                  organization_id: organizationId,
                })
                .update({
                  running_number: parseInt(runningNumber) + 1,
                  has_record: 1,
                });
            }
          };

          findUniquePrefix();
        } else {
          db.collection("purchase_order").doc(purchaseOrderId).update(entry);
        }
      })
      .then(() => {
        addOnPO();
        closeDialog();
      })
      .catch((error) => {
        alert(error);
      });
  }
});
