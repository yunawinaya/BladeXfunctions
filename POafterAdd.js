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
        received_qty: 0,
        open_qty: 0,
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
  }
};

if (page_status === "Add" || page_status === "Clone") {
  this.getData()
    .then((data) => {
      db.collection("purchase_order").add({
        po_status: "Issued",
        purchase_order_no: data.purchase_order_no,
        po_supplier_id: data.po_supplier_id,
        po_date: data.po_date,
        organization_id: data.organization_id,
        po_currency: data.po_currency,
        po_delivery_address: data.po_delivery_address,
        po_plant: data.po_plant,
        po_receiving_supplier: data.po_receiving_supplier,
        po_billing_name: data.po_billing_name,
        po_billing_cp: data.po_billing_cp,
        po_billing_address: data.po_billing_address,
        po_shipping_address: data.po_shipping_address,
        po_payment_terms: data.po_payment_terms,
        po_expected_date: data.po_expected_date,
        po_shipping_preference: data.po_shipping_preference,
        po_ref_doc: data.po_ref_doc,
        table_po: data.table_po,
        po_total_gross: data.po_total_gross,
        po_total_discount: data.po_total_discount,
        po_total_tax: data.po_total_tax,
        po_total: data.po_total,
        po_remark: data.po_remark,
        po_tnc: data.po_tnc,
        billing_address_line_1: data.billing_address_line_1,
        billing_address_line_2: data.billing_address_line_2,
        billing_address_line_3: data.billing_address_line_3,
        billing_address_line_4: data.billing_address_line_4,
        billing_address_city: data.billing_address_city,
        billing_postal_code: data.billing_postal_code,
        billing_address_state: data.billing_address_state,
        billing_address_country: data.billing_address_country,
        shipping_address_line_1: data.shipping_address_line_1,
        shipping_address_line_2: data.shipping_address_line_2,
        shipping_address_line_3: data.shipping_address_line_3,
        shipping_address_line_4: data.shipping_address_line_4,
        shipping_address_city: data.shipping_address_city,
        shipping_postal_code: data.shipping_postal_code,
        shipping_address_state: data.shipping_address_state,
        shipping_address_country: data.shipping_address_country,
      });
    })
    .then(() => {
      addOnPO();
      closeDialog();
    })
    .catch((error) => {
      alert(
        "Please fill in all required fields marked with (*) before submitting."
      );
    });
} else if (page_status === "Edit") {
  const purchaseOrderId = this.getParamsVariables("purchase_order_no");
  this.getData()
    .then((data) => {
      db.collection("purchase_order").doc(purchaseOrderId).update({
        po_status: "Issued",
        purchase_order_no: data.purchase_order_no,
        po_supplier_id: data.po_supplier_id,
        po_date: data.po_date,
        organization_id: data.organization_id,
        po_currency: data.po_currency,
        po_delivery_address: data.po_delivery_address,
        po_plant: data.po_plant,
        po_receiving_supplier: data.po_receiving_supplier,
        po_billing_name: data.po_billing_name,
        po_billing_cp: data.po_billing_cp,
        po_billing_address: data.po_billing_address,
        po_shipping_address: data.po_shipping_address,
        po_payment_terms: data.po_payment_terms,
        po_expected_date: data.po_expected_date,
        po_shipping_preference: data.po_shipping_preference,
        po_ref_doc: data.po_ref_doc,
        table_po: data.table_po,
        po_total_gross: data.po_total_gross,
        po_total_discount: data.po_total_discount,
        po_total_tax: data.po_total_tax,
        po_total: data.po_total,
        po_remark: data.po_remark,
        po_tnc: data.po_tnc,
        billing_address_line_1: data.billing_address_line_1,
        billing_address_line_2: data.billing_address_line_2,
        billing_address_line_3: data.billing_address_line_3,
        billing_address_line_4: data.billing_address_line_4,
        billing_address_city: data.billing_address_city,
        billing_postal_code: data.billing_postal_code,
        billing_address_state: data.billing_address_state,
        billing_address_country: data.billing_address_country,
        shipping_address_line_1: data.shipping_address_line_1,
        shipping_address_line_2: data.shipping_address_line_2,
        shipping_address_line_3: data.shipping_address_line_3,
        shipping_address_line_4: data.shipping_address_line_4,
        shipping_address_city: data.shipping_address_city,
        shipping_postal_code: data.shipping_postal_code,
        shipping_address_state: data.shipping_address_state,
        shipping_address_country: data.shipping_address_country,
      });
    })
    .then(() => {
      addOnPO();
      closeDialog();
    })
    .catch((error) => {
      alert(
        "Please fill in all required fields marked with (*) before submitting."
      );
    });
}
