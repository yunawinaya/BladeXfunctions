const data = this.getValues();
const plant = this.getValue("po_plant");
console.log("po_plant", plant);
if (plant) {
  this.display("address_grid");
  const resetFormFields = () => {
    this.setData({
      po_billing_name: "",
      po_billing_cp: "",
      po_shipping_address: "",
      po_billing_address: "",
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
    ];

    return addressComponents
      .filter(Boolean)
      .join(",\n")
      .replace(/([^,])\n/g, "$1,\n");
  };

  const setAddressFields = (addressType, address, state, country) => {
    this.setData({
      [`${addressType}_address_line_1`]: address.address_line_1,
      [`${addressType}_address_line_2`]: address.address_line_2,
      [`${addressType}_address_line_3`]: address.address_line_3,
      [`${addressType}_address_line_4`]: address.address_line_4,
      [`${addressType}_address_city`]: address.address_city,
      [`${addressType}_address_state`]: state.id,
      [`${addressType}_postal_code`]: address.address_postal_code,
      [`${addressType}_address_country`]: country.id,
      [`po_${addressType}_address`]: formatAddress(address, state, country),
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
            po_billing_name: address.address_name,
            po_billing_cp: address.address_phone,
          });
        }
      });
    });
  });
}
