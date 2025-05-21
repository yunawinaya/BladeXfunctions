const data = this.getValues();

const soId = data.sr_return_so_id;
const plant = data.plant_id;

this.setData({
  sr_return_gd_id: [],
});

const salesOrderIds = Array.isArray(soId) ? soId : [soId];

if (salesOrderIds.length > 0) {
  if (salesOrderIds.length > 0 && salesOrderIds[0]) {
    this.disabled(["plant_id"], false);

    // Set SO numbers in so_no field
    if (salesOrderIds.length > 1) {
      // Multiple SOs - fetch and join numbers
      Promise.all(
        salesOrderIds.map((soId) =>
          db
            .collection("sales_order")
            .where({ id: soId })
            .get()
            .then((response) => {
              if (response.data && response.data.length > 0) {
                return response.data[0].so_no;
              }
              return "";
            })
        )
      )
        .then((soNumbers) => {
          const validSoNumbers = soNumbers.filter(Boolean);
          this.setData({
            so_no_display: validSoNumbers.join(", "),
          });
        })
        .catch((error) => {
          console.error("Error fetching SO numbers:", error);
        });
    } else {
      // Single SO - fetch and set number
      db.collection("sales_order")
        .where({ id: salesOrderIds[0] })
        .get()
        .then((response) => {
          if (response.data && response.data.length > 0) {
            this.setData({
              so_no_display: response.data[0].so_no,
            });
          }
        })
        .catch((error) => {
          console.error("Error fetching SO number:", error);
        });
    }
  }

  this.display("address_grid");
  const resetFormFields = () => {
    this.setData({
      sr_billing_name: "",
      sr_billing_cp: "",
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
    ].filter((component) => component);

    return addressComponents.join(",\n");
  };

  const setAddressFields = (addressType, address, country, state) => {
    this.setData({
      [`${addressType}_address_line_1`]: address.address_line_1,
      [`${addressType}_address_line_2`]: address.address_line_2,
      [`${addressType}_address_line_3`]: address.address_line_3,
      [`${addressType}_address_line_4`]: address.address_line_4,
      [`${addressType}_address_city`]: address.address_city,
      [`${addressType}_address_state`]: state.id,
      [`${addressType}_postal_code`]: address.address_postal_code,
      [`${addressType}_address_country`]: country.id,
      [`sr_${addressType}_address`]: formatAddress(address, state, country),
    });
  };
  resetFormFields();

  Promise.all([
    db.collection("address_purpose").where({ purpose_name: "Shipping" }).get(),
    db.collection("plant_address").where({ plant_id: plant }).get(),
  ]).then(([resShipping, resPlant]) => {
    if (resPlant.data.length === 0 || resShipping.data.length === 0) return;

    const addresses = resPlant.data;
    const shippingAddrId = resShipping.data[0].id;

    addresses.forEach((address) => {
      Promise.all([
        db
          .collection("country")
          .where({ id: address.address_country_id })
          .get(),
        db.collection("state").where({ id: address.address_state }).get(),
      ]).then(([resCountry, resState]) => {
        if (resCountry.data.length === 0 || resState.data.length === 0) return;

        const isShipping = address.plant_purpose === shippingAddrId;
        const addressType = isShipping ? "shipping" : "billing";

        setAddressFields(
          addressType,
          address,
          resState.data[0],
          resCountry.data[0]
        );

        if (addressType !== "shipping") {
          this.setData({
            sr_billing_name: address.address_name,
            sr_billing_cp: address.address_phone,
          });
        }
      });
    });
  });
}
