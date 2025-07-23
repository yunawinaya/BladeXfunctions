const purchaseRequisitionId = arguments[0].row.id;
const status = arguments[0].row.preq_status;

if (status === "Issued") {
  db.collection("purchase_requisition")
    .where({ id: purchaseRequisitionId })
    .get()
    .then((resPR) => {
      const data = resPR.data[0];
      const poLineItemPromises = [];
      data.table_pr.forEach((item) => {
        const lineItemPromise = {
          item_id: item.pr_line_material_id,
          item_name: item.pr_line_material_name,
          item_desc: item.pr_line_material_desc,
          quantity: item.pr_line_qty,
          quantity_uom: item.pr_line_uom_id,
          unit_price: item.pr_line_unit_price,
          gross: item.pr_line_gross,
          discount: item.pr_line_discount,
          discount_uom: item.pr_line_discount_uom,
          discount_amount: item.pr_line_discount_amount,
          tax_preference: item.pr_line_tax_rate_id,
          tax_rate_percent: item.pr_line_taxes_percent,
          tax_amount: item.pr_line_tax_fee_amount,
          tax_inclusive: item.pr_tax_inclusive,
          po_amount: item.pr_line_amount,
          more_desc: item.more_desc,
          line_remark_1: item.line_remark_1,
          line_remark_2: item.line_remark_2,
        };

        poLineItemPromises.push(lineItemPromise);
      });

      db.collection("prefix_configuration")
        .where({ document_types: "Purchase Orders", is_deleted: 0 })
        .get()
        .then((prefixEntry) => {
          if (!prefixEntry.data || prefixEntry.data.length === 0) {
            throw new Error("No prefix configuration found");
          }

          const currDraftNum = parseInt(prefixEntry.data[0].draft_number) + 1;
          const newPrefix = "DRAFT-PO-" + currDraftNum;

          const lineItemLength = data.table_pr.length;

          db.collection("purchase_order").add({
            po_status: "Draft",
            preq_no: data.pr_no,
            purchase_order_no: newPrefix, // Use generated prefix
            po_supplier_id: data.pr_supplier_name,
            po_date: new Date(),
            organization_id: data.organization_id,
            po_currency: data.currency_code,
            po_delivery_address: "Organization",
            exchange_rate_currency: data.currency_code,
            total_gross_currency: data.currency_code,
            total_discount_currency: data.currency_code,
            total_tax_currency: data.currency_code,
            total_amount_currency: data.currency_code,
            exchange_rate: data.exchange_rate,
            po_plant: data.plant_id,
            po_receiving_supplier: "",
            po_billing_address: data.preq_billing_address,
            po_shipping_address: data.preq_shipping_address,
            po_payment_terms: data.pr_payment_term_id,
            po_expected_date: data.pr_delivery_date,
            po_shipping_preference: data.pr_ship_preference_id,
            table_po: poLineItemPromises,
            po_total_gross: data.pr_sub_total,
            po_total_discount: data.pr_discount_total,
            po_total_tax: data.pr_total_tax_fee,
            po_total: data.pr_total_price,
            po_remark: data.pr_remark,
            po_tnc: data.pr_term_condition,
            billing_address_line_1: data.billing_address_line_1,
            billing_address_line_2: data.billing_address_line_2,
            billing_address_line_3: data.billing_address_line_3,
            billing_address_line_4: data.billing_address_line_4,
            billing_address_city: data.billing_address_city,
            billing_postal_code: data.billing_postal_code,
            billing_address_state: data.billing_address_state,
            billing_address_country: data.billing_address_country,
            billing_address_phone: data.billing_address_phone,
            billing_address_name: data.billing_address_name,
            billing_attention: data.billing_attention,
            shipping_address_line_1: data.shipping_address_line_1,
            shipping_address_line_2: data.shipping_address_line_2,
            shipping_address_line_3: data.shipping_address_line_3,
            shipping_address_line_4: data.shipping_address_line_4,
            shipping_address_city: data.shipping_address_city,
            shipping_postal_code: data.shipping_postal_code,
            shipping_address_state: data.shipping_address_state,
            shipping_address_country: data.shipping_address_country,
            shipping_address_phone: data.shipping_address_phone,
            shipping_address_name: data.shipping_address_name,
            shipping_attention: data.shipping_attention,
            myr_total_amount: data.myr_total_amount,
            partially_received: `0 / ${lineItemLength}`,
            fully_received: `0 / ${lineItemLength}`,
          });
          return currDraftNum;
        })
        .then((currDraftNum) => {
          return db
            .collection("prefix_configuration")
            .where({ document_types: "Purchase Orders" })
            .update({ draft_number: currDraftNum });
        })
        .then(() => {
          db.collection("purchase_requisition")
            .doc(purchaseRequisitionId)
            .update({
              preq_status: "Completed",
            });
        })
        .then(async () => {
          this.runWorkflow(
            "1925867835812556802",
            { preq_id: purchaseRequisitionId },
            (res) => {
              console.log("成功结果：", res);
            },
            (err) => {
              console.error("失败结果：", err);
            }
          );
        })
        .then(() => {
          this.refresh();
          this.$message.success("Successfully converted to Purchase Order");
        })
        .catch((error) => {
          this.$message.error(error);
        });
    });
} else {
  this.$message.error(
    "This record cannot be converted to Purchase Order because its status is currently " +
      status +
      "."
  );
}
