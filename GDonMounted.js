const page_status = this.getParamsVariables("page_status");

if (page_status !== "Add") {
  const goodsDeliveryId = this.getParamsVariables("goods_delivery_no");
  db.collection("goods_delivery")
    .where({ id: goodsDeliveryId })
    .get()
    .then(async (resGD) => {
      const goodsDelivery = resGD.data[0];

      const {
        gd_status,
        so_id,
        so_no,
        gd_billing_name,
        gd_billing_cp,
        delivery_no,
        gd_ref_doc,
        plant_id,
        organization_id,
        customer_name,
        gd_contact_name,
        contact_number,
        email_address,
        document_description,
        gd_delivery_method,
        delivery_date,
        driver_name,
        driver_contact_no,
        validity_of_collection,
        vehicle_no,
        pickup_date,
        courier_company,
        shipping_date,
        freight_charges,
        tracking_number,
        est_arrival_date,
        driver_cost,
        est_delivery_date,
        shipping_company,
        shipping_method,
        table_gd,
        order_remark,
        billing_address_line_1,
        billing_address_line_2,
        billing_address_line_3,
        billing_address_line_4,
        billing_address_city,
        billing_address_state,
        billing_address_country,
        billing_postal_code,
        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        shipping_address_city,
        shipping_address_state,
        shipping_address_country,
        shipping_postal_code,
      } = goodsDelivery;

      const gd = {
        gd_status,
        so_id,
        so_no,
        gd_billing_name,
        gd_billing_cp,
        delivery_no,
        gd_ref_doc,
        plant_id,
        organization_id,
        customer_name,
        gd_contact_name,
        contact_number,
        email_address,
        document_description,
        gd_delivery_method,
        delivery_date,
        driver_name,
        driver_contact_no,
        validity_of_collection,
        vehicle_no,
        pickup_date,
        courier_company,
        shipping_date,
        freight_charges,
        tracking_number,
        est_arrival_date,
        driver_cost,
        est_delivery_date,
        shipping_company,
        shipping_method,
        table_gd,
        order_remark,
        billing_address_line_1,
        billing_address_line_2,
        billing_address_line_3,
        billing_address_line_4,
        billing_address_city,
        billing_address_state,
        billing_address_country,
        billing_postal_code,
        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        shipping_address_city,
        shipping_address_state,
        shipping_address_country,
        shipping_postal_code,
      };

      await this.setData(gd);

      switch (gd_status) {
        case "Draft":
          this.display(["draft_status"]);
          break;
        case "Created":
          this.display(["created_status"]);
          break;
        case "Completed":
          this.display(["completed_status"]);
          break;
      }
    });

  if (page_status === "View") {
    this.disabled(
      [
        "gd_status",
        "so_id",
        "so_no",
        "gd_billing_name",
        "gd_billing_cp",
        "gd_billing_address",
        "gd_shipping_address",
        "delivery_no",
        "gd_ref_doc",
        "customer_name",
        "gd_contact_name",
        "contact_number",
        "email_address",
        "document_description",
        "plant_id",
        "organization_id",
        "gd_delivery_method",
        "delivery_date",
        "driver_name",
        "driver_contact_no",
        "validity_of_collection",
        "vehicle_no",
        "pickup_date",
        "courier_company",
        "shipping_date",
        "freight_charges",
        "tracking_number",
        "est_arrival_date",
        "driver_cost",
        "est_delivery_date",
        "shipping_company",
        "shipping_method",
        "order_remark",
        "billing_address_line_1",
        "billing_address_line_2",
        "billing_address_line_3",
        "billing_address_line_4",
        "billing_address_city",
        "billing_address_state",
        "billing_address_country",
        "billing_postal_code",
        "shipping_address_line_1",
        "shipping_address_line_2",
        "shipping_address_line_3",
        "shipping_address_line_4",
        "shipping_address_city",
        "shipping_address_state",
        "shipping_address_country",
        "shipping_postal_code",
        "gd_item_balance.table_item_balance",
      ],
      true
    );

    setTimeout(() => {
      const data = this.getValues();
      const rows = data.table_gd || [];

      rows.forEach((row, index) => {
        const fieldNames = Object.keys(row).filter(
          (key) => key !== "gd_delivery_qty"
        );

        const fieldsToDisable = fieldNames.map(
          (field) => `table_gd.${index}.${field}`
        );

        this.disabled(fieldsToDisable, true);
      });
    }, 1000);

    this.hide([
      "link_billing_address",
      "link_shipping_address",
      "button_save_as_draft",
      "button_save_as_completed",
      "button_save_as_created",
      "so_id",
    ]);

    this.display(["so_no"]);
  }
} else {
  this.display(["draft_status"]);
  this.reset();
  const prefixEntry = db
    .collection("prefix_configuration")
    .where({ document_types: "Goods Delivery" })
    .get()
    .then((prefixEntry) => {
      if (prefixEntry) {
        const prefixData = prefixEntry.data[0];
        const now = new Date();
        let prefixToShow = prefixData.current_prefix_config;

        if (prefixData.is_active === 1) {
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

          this.setData({ delivery_no: prefixToShow });
          this.disabled(["delivery_no"], true);
        }
      }
    });
}
