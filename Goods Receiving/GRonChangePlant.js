const resetFormData = () => {
  this.setData({
    supplier_name: "",
    currency_code: "",
    purchase_order_number: "",
    gr_billing_name: "",
    gr_billing_cp: "",
    gr_billing_address: "",
    gr_shipping_address: "",
    supplier_contact_person: "",
    supplier_contact_number: "",
    supplier_email: "",
    gr_dockey: "",
    table_gr: [],

    po_id: [],
    assigned_to: "",
    predefined_data: [],

    billing_address_line_1: "",
    billing_address_line_2: "",
    billing_address_line_3: "",
    billing_address_line_4: "",

    billing_address_city: "",
    billing_postal_code: "",
    billing_address_state: "",
    billing_address_country: "",

    shipping_address_line_1: "",
    shipping_address_line_2: "",
    shipping_address_line_3: "",
    shipping_address_line_4: "",

    shipping_address_city: "",
    shipping_postal_code: "",
    shipping_address_state: "",
    shipping_address_country: "",
    ref_no_1: "",
    ref_no_2: "",
  });
};
(async () => {
  setTimeout(async () => {
    const plant = this.getValue("plant_id");
    console.log("arguments", arguments[0]);
    if (plant) {
      this.hide(["address_grid", "assigned_to"]);
      if (arguments[0]?.fieldModel) {
        await resetFormData();
      }
      this.disabled(
        ["reference_doc", "ref_no_1", "ref_no_2", "table_gr"],
        false
      );

      const [resStorageLocation, resPutAwaySetup, resCategory] =
        await Promise.all([
          db
            .collection("storage_location")
            .field("id")
            .where({
              plant_id: plant,
              is_deleted: 0,
              is_default: 1,
              location_type: "Common",
            })
            .get(),
          db
            .collection("putaway_setup")
            .where({
              plant_id: plant,
              is_deleted: 0,
              movement_type: "Good Receiving",
            })
            .get(),
          db
            .collection("blade_dict")
            .where({ code: "inventory_category" })
            .get(),
        ]);

      let defaultBinLocation = "";

      if (resStorageLocation.data.length === 1) {
        await this.disabled(["table_gr.location_id"], false);

        await db
          .collection("bin_location")
          .where({
            storage_location_id: resStorageLocation.data[0].id,
            plant_id: plant,
            is_default: 1,
            is_deleted: 0,
          })
          .get()
          .then((res) => {
            if (res.data.length > 0) {
              defaultBinLocation = res.data[0].id;
            }
          });
      }

      const putawaySetup = resPutAwaySetup?.data[0] || null;
      const defaultStorageLocation = resStorageLocation?.data[0]?.id || "";
      const invCategory = resCategory?.data || null;

      const predefinedData = [
        {
          putawaySetup: putawaySetup,
          defaultStorageLocation: defaultStorageLocation,
          defaultBinLocation: defaultBinLocation,
          invCategory: invCategory,
        },
      ];

      this.setData({ predefined_data: predefinedData });
      console.log(predefinedData);
    }
  }, 50);
})();
