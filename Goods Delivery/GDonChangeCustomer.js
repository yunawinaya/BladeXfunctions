(async () => {
  try {
    const customerId = arguments[0]?.value;
    const customerChangeId = this.getValue("customer_change_id");

    const customerContactData = arguments[0]?.fieldModel?.item.contact_list[0];

    // Handle customer ID change
    if (
      customerId &&
      (!customerChangeId || customerChangeId !== customerId) &&
      !Array.isArray(customerId)
    ) {
      console.log("Customer changed to:", customerId);

      // Update tracking field and reset SO selection
      await this.setData({ customer_change_id: customerId });
      await this.setData({ so_id: undefined });
      await this.disabled(["so_id"], false);
      await this.setData({
        gd_contact_name: customerContactData.person_name,
        contact_number: customerContactData.mobile_number,
        email_address: customerContactData.person_email,
      });

      // Display address section
      this.display("address_grid");

      // Reset all address fields
      const resetFormFields = () => {
        this.setData({
          gd_billing_name: "", // Using GD prefix for Goods Delivery
          gd_billing_cp: "",
          gd_billing_address: "",
          gd_shipping_address: "",
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

      resetFormFields();

      // Helper function to set address fields
      const setDialogAddressFields = (
        addressType,
        address,
        stateId,
        countryId
      ) => {
        this.setData({
          [`${addressType}_address_line_1`]: address.address_line_1,
          [`${addressType}_address_line_2`]: address.address_line_2,
          [`${addressType}_address_line_3`]: address.address_line_3,
          [`${addressType}_address_line_4`]: address.address_line_4,
          [`${addressType}_address_city`]: address.address_city,
          [`${addressType}_address_state`]: stateId,
          [`${addressType}_postal_code`]: address.address_postal_code,
          [`${addressType}_address_country`]: countryId,
        });
      };

      // Fetch customer data
      const resCustomer = await db
        .collection("Customer")
        .where({ id: customerId })
        .get();

      if (!resCustomer?.data || resCustomer.data.length === 0) {
        console.error("Customer not found:", customerId);
        return;
      }

      const customerData = resCustomer.data[0];

      // Get all default addresses
      const addresses =
        customerData.address_list?.filter(
          (address) => address.switch_save_as_default
        ) || [];

      if (addresses.length === 0) {
        console.warn("No default addresses found for customer:", customerId);
        return;
      }

      // Process each address
      for (const address of addresses) {
        try {
          // Fetch related data in parallel
          const [resCountry, resState, resShipping] = await Promise.all([
            db
              .collection("country")
              .where({ id: address.address_country_id })
              .get(),
            db.collection("state").where({ id: address.adddress_state }).get(),
            db
              .collection("address_purpose")
              .where({ purpose_name: "Shipping" })
              .get(),
          ]);

          if (
            !resCountry?.data?.length ||
            !resState?.data?.length ||
            !resShipping?.data?.length
          ) {
            console.warn(
              "Missing country, state, or purpose data for address:",
              address
            );
            continue;
          }

          const countryName = resCountry.data[0].country_name;
          const stateName = resState.data[0].state_name;
          const shippingAddrId = resShipping.data[0].id;

          // Format address for display
          const addressComponents = [
            address.address_line_1,
            address.address_line_2,
            address.address_line_3,
            address.address_line_4,
            address.address_city,
            address.address_postal_code,
            stateName,
            countryName,
          ];

          const formattedAddress = addressComponents
            .filter(Boolean)
            .join(",\n")
            .replace(/([^,])\n/g, "$1,\n");

          // Determine address type and set fields
          const isShipping = address.address_purpose_id === shippingAddrId;
          const addressType = isShipping ? "shipping" : "billing";

          setDialogAddressFields(
            addressType,
            address,
            resState.data[0].id,
            resCountry.data[0].id
          );

          if (addressType === "shipping") {
            this.setData({ gd_shipping_address: formattedAddress });
          } else {
            this.setData({
              gd_billing_address: formattedAddress,
              gd_billing_name: address.address_name,
              gd_billing_cp: address.address_phone,
            });
          }
        } catch (addressError) {
          console.error("Error processing address:", addressError);
        }
      }
    }
  } catch (error) {
    console.error("Error in customer address processing:", error);
  }
})();
