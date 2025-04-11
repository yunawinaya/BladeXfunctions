this.hide(["self_pickup", "courier_service", "company_truck"]);
const page_status = this.getParamsVariables("page_status");

let organizationId = this.getVarGlobal("deptParentId");
if (organizationId === "0") {
  organizationId = this.getVarSystem("deptIds").split(",")[0];
}

if (page_status !== "Add") {
  const purchaseReturnId = this.getParamsVariables("purchase_return_no");
  db.collection("purchase_return_head")
    .where({ id: purchaseReturnId })
    .get()
    .then((resPRT) => {
      const purchaseReturn = resPRT.data[0];

      const {
        purchase_return_status,
        purchase_return_no,
        purchase_order_id,
        goods_receiving_id,
        gr_ids,
        organization_id,
        supplier_id,
        prt_billing_name,
        prt_billing_cp,
        gr_date,
        plant,
        purchase_return_date,
        input_hvxpruem,
        return_delivery_method,
        purchase_return_ref,
        shipping_details,
        reason_for_return,
        driver_name,
        vehicle_no,
        driver_contact,
        pickup_date,
        courier_company,
        shipping_date,
        estimated_arrival,
        shipping_method,
        freight_charge,
        driver_name2,
        driver_contact_no2,
        estimated_arrival2,
        vehicle_no2,
        delivery_cost,
        table_prt,
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
      } = purchaseReturn;

      const prt = {
        purchase_return_status,
        purchase_return_no,
        purchase_order_id,
        goods_receiving_id,
        gr_ids,
        organization_id,
        supplier_id,
        prt_billing_name,
        prt_billing_cp,
        gr_date,
        plant,
        purchase_return_date,
        input_hvxpruem,
        return_delivery_method,
        purchase_return_ref,
        shipping_details,
        reason_for_return,
        driver_name,
        vehicle_no,
        driver_contact,
        pickup_date,
        courier_company,
        shipping_date,
        estimated_arrival,
        shipping_method,
        freight_charge,
        driver_name2,
        driver_contact_no2,
        estimated_arrival2,
        vehicle_no2,
        delivery_cost,
        table_prt,
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

      const prefixEntry = db
        .collection("prefix_configuration")
        .where({
          document_types: "Purchase Returns",
          is_deleted: 0,
          organization_id: organizationId,
        })
        .get()
        .then((prefixEntry) => {
          if (prefixEntry.data[0].is_active === 0) {
            this.disabled(["purchase_return_no"], false);
          }
        });

      this.setData(prt);

      switch (purchase_return_status) {
        case "Draft":
          this.display(["draft_status"]);
          break;
        case "Issued":
          this.display(["issued_status"]);
          break;
      }
    });

  if (page_status === "View") {
    this.disabled(
      [
        "purchase_return_status",
        "purchase_return_no",
        "purchase_order_id",
        "goods_receiving_id",
        "organization_id",
        "supplier_id",
        "prt_billing_name",
        "prt_billing_cp",
        "prt_billing_address",
        "prt_shipping_address",
        "gr_date",
        "plant",
        "purchase_return_date",
        "input_hvxpruem",
        "return_delivery_method",
        "purchase_return_ref",
        "shipping_details",
        "reason_for_return",
        "driver_name",
        "vehicle_no",
        "driver_contact",
        "pickup_date",
        "courier_company",
        "shipping_date",
        "estimated_arrival",
        "shipping_method",
        "freight_charge",
        "driver_name2",
        "driver_contact_no2",
        "estimated_arrival2",
        "vehicle_no2",
        "delivery_cost",
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
        "confirm_inventory.table_item_balance",
      ],
      true
    );

    setTimeout(() => {
      const data = this.getValues();
      const rows = data.table_prt || [];

      rows.forEach((row, index) => {
        const fieldNames = Object.keys(row).filter(
          (key) => key !== "select_return_qty"
        );

        const fieldsToDisable = fieldNames.map(
          (field) => `table_prt.${index}.${field}`
        );

        this.disabled(fieldsToDisable, true);
      });
    }, 1000);

    this.hide([
      "link_billing_address",
      "link_shipping_address",
      "button_save_as_draft",
      "button_save_as_issue",
    ]);
  }
} else {
  this.display(["draft_status"]);

  this.reset();

  const prefixEntry = db
    .collection("prefix_configuration")
    .where({
      document_types: "Purchase Returns",
      is_deleted: 0,
      organization_id: organizationId,
    })
    .get()
    .then((prefixEntry) => {
      const prefixData = prefixEntry.data[0];
      const now = new Date();
      let prefixToShow;
      let runningNumber = prefixData.running_number;
      let isUnique = false;
      let maxAttempts = 10;
      let attempts = 0;

      if (prefixData.is_active === 0) {
        this.disabled(["purchase_return_no"], false);
      }

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
          .collection("purchase_return_head")
          .where({ purchase_return_no: generatedPrefix })
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
            "Could not generate a unique Purchase Return number after maximum attempts"
          );
        }
        return { prefixToShow, runningNumber };
      };

      return findUniquePrefix();
    })
    .then(({ prefixToShow, runningNumber }) => {
      this.setData({ purchase_return_no: prefixToShow });
    })
    .catch((error) => {
      alert(error);
    });
}
