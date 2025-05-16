(async () => {
  const plant = arguments[0]?.value;
  const table_gr = this.getValue("table_gr");
  const po_numbers = this.getValue("purchase_order_id");

  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }

  await this.setData({
    organization_id: organizationId,
  });

  // First, set the bin location for items
  if (plant && po_numbers && po_numbers.length > 0) {
    const resBinLocation = await db
      .collection("bin_location")
      .where({
        plant_id: plant,
        is_default: true,
      })
      .get();

    let binLocation;

    if (resBinLocation.data && resBinLocation.data.length > 0) {
      binLocation = resBinLocation.data[0].id;
    } else {
      console.warn("No default bin location found for plant:", plant);
    }

    if (table_gr && table_gr.length > 0) {
      for (let i = 0; i < table_gr.length; i++) {
        this.setData({
          [`table_gr.${i}.location_id`]: binLocation,
        });
      }
    }
  }

  // Now handle the address information
  if (plant) {
    this.display("address_grid");

    // Reset address fields function
    const resetFormFields = () => {
      this.setData({
        gr_billing_name: "",
        gr_billing_cp: "",
        gr_shipping_address: "",
        gr_billing_address: "",
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

    // Format address function
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

    // Set address fields function
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
        [`gr_${addressType}_address`]: formatAddress(address, state, country),
      });
    };

    // Reset the form fields first
    resetFormFields();

    // Fetch plant addresses and shipping purpose
    try {
      const [resShipping, resPlant] = await Promise.all([
        db
          .collection("address_purpose")
          .where({ purpose_name: "Shipping" })
          .get(),
        db.collection("plant_address").where({ plant_id: plant }).get(),
      ]);

      if (
        !resPlant.data ||
        resPlant.data.length === 0 ||
        !resShipping.data ||
        resShipping.data.length === 0
      ) {
        console.warn("Missing plant address or shipping purpose data");
        return;
      }

      const addresses = resPlant.data;
      const shippingAddrId = resShipping.data[0].id;

      // Process each address
      for (const address of addresses) {
        try {
          const [resCountry, resState] = await Promise.all([
            db
              .collection("country")
              .where({ id: address.address_country_id })
              .get(),
            db.collection("state").where({ id: address.address_state }).get(),
          ]);

          if (
            !resCountry.data ||
            resCountry.data.length === 0 ||
            !resState.data ||
            resState.data.length === 0
          ) {
            console.warn("Missing country or state data for address");
            continue;
          }

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
              gr_billing_name: address.address_name || "",
              gr_billing_cp: address.address_phone || "",
            });
          }
        } catch (error) {
          console.error("Error processing address:", error);
        }
      }
    } catch (error) {
      console.error("Error fetching address data:", error);
    }
  }
})();
