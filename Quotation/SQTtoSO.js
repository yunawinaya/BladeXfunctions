const quotationId = arguments[0].row.id;
const status = arguments[0].row.sqt_status;

if (status === "Issued") {
  db.collection("Quotation")
    .where({ id: quotationId })
    .get()
    .then((resSQT) => {
      const data = resSQT.data[0];
      const sqtLineItemPromises = [];
      data.table_sqt.forEach((item) => {
        const lineItemPromise = {
          item_name: item.material_id,
          so_desc: item.sqt_desc,
          so_quantity: item.quantity,
          so_item_uom: item.sqt_order_uom_id,
          so_item_price: item.unit_price,
          so_gross: item.sqt_gross,
          so_discount: item.sqt_discount,
          so_discount_uom: item.sqt_discount_uom_id,
          so_discount_amount: item.sqt_discount_amount,
          so_tax_preference: item.sqt_taxes_rate_id,
          so_tax_percentage: item.sqt_tax_rate_percent,
          so_tax_amount: item.sqt_taxes_fee_amount,
          so_tax_inclusive: item.sqt_tax_inclusive,
          so_brand: item.sqt_brand_id,
          so_packaging_style: item.sqt_packaging_id,
          so_amount: item.total_price,
        };
        sqtLineItemPromises.push(lineItemPromise);
      });

      db.collection("prefix_configuration")
        .where({ document_types: "Sales Orders", is_deleted: 0 })
        .get()
        .then((prefixEntry) => {
          if (!prefixEntry.data || prefixEntry.data.length === 0) {
            throw new Error("No prefix configuration found");
          }

          const currDraftNum = parseInt(prefixEntry.data[0].draft_number) + 1;
          const newPrefix = "DRAFT-SO-" + currDraftNum;
          db.collection("sales_order").add({
            so_status: "Draft",
            so_no: newPrefix,
            sqt_no: data.sqt_no,
            so_date: new Date(),
            so_sales_person: data.sales_person_id,
            customer_name: data.sqt_customer_id,
            customer_change_id: data.sqt_customer_id,
            so_currency: data.currency_code,
            organization_id: data.organization_id,
            plant_name: data.sqt_plant,
            cust_billing_name: data.sqt_billing_address,
            cust_billing_cp: data.sqt_billing_cp,
            cust_billing_address: data.sqt_billing_address,
            cust_shipping_address: data.sqt_shipping_address,
            so_payment_term: data.sqt_payment_term,
            so_delivery_method: data.sqt_delivery_method_id,
            cp_driver_name: data.cp_customer_pickup,
            cp_driver_contact_no: data.driver_contact_no,
            cp_vehicle_number: data.vehicle_number,
            cp_pickup_date: data.pickup_date,
            cs_courier_company: data.courier_company,
            cs_shipping_date: data.shipping_date,
            ct_driver_name: data.ct_driver_name,
            ct_driver_contact_no: data.ct_driver_contact_no,
            ct_delivery_cost: data.ct_delivery_cost,
            ct_vehicle_number: data.ct_vehicle_number,
            ct_est_delivery_date: data.ct_est_delivery_date,
            ss_shipping_company: data.ss_shipping_company,
            ss_shippping_date: data.ss_shipping_date,
            ss_freight_charges: data.ss_freight_charges,
            ss_shipping_method: data.ss_shipping_method,
            ss_est_arrival_date: data.est_arrival_date,
            ss_tracking_number: data.ss_tracking_number,
            table_so: sqtLineItemPromises,
            so_total_gross: data.sqt_sub_total,
            so_total_discount: data.sqt_total_discount,
            so_total_tax: data.sqt_total_tax,
            so_total: data.sqt_totalsum,
            so_remarks: data.sqt_remarks,
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
          return currDraftNum;
        })
        .then((currDraftNum) => {
          return db
            .collection("prefix_configuration")
            .where({ document_types: "Sales Orders" })
            .update({ draft_number: currDraftNum });
        })
        .then(() => {
          db.collection("Quotation").doc(quotationId).update({
            sqt_status: "Completed",
          });
        })
        .then(() => {
          this.refresh();
          alert("Successfully converted to Sales Order");
        })
        .catch((error) => {
          console.log(error);
        });
    });
} else {
  alert(
    "This record cannot be converted to Sales Order because its status is currently " +
      status +
      "."
  );
}
