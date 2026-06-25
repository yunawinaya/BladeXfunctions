const resetAddrData = async () => {
  this.setData({
    gr_billing_address: "",
    gr_shipping_address: "",

    billing_address_line_1: "",
    billing_address_line_2: "",
    billing_address_line_3: "",
    billing_address_line_4: "",
    billing_address_city: "",
    billing_address_state: "",
    billing_postal_code: "",
    billing_address_country: "",
    billing_address_name: "",
    billing_address_phone: "",
    billing_attention: "",
    billing_address_fax: "",

    shipping_address_line_1: "",
    shipping_address_line_2: "",
    shipping_address_line_3: "",
    shipping_address_line_4: "",
    shipping_address_city: "",
    shipping_address_state: "",
    shipping_postal_code: "",
    shipping_address_country: "",
    shipping_address_name: "",
    shipping_address_phone: "",
    shipping_attention: "",
    shipping_address_fax: "",
  });
};
const processAddressInformation = async () => {
  try {
    const supplierId = this.getValue("supplier_name");

    if (supplierId) {
      this.display("address_grid");
      await resetAddrData();
      // Get shipping purpose and supplier data concurrently
      const [resShipping, resSupplier] = await Promise.all([
        db
          .collection("address_purpose")
          .where({ purpose_name: "Shipping" })
          .get(),
        db.collection("supplier_head").where({ id: supplierId }).get(),
      ]);

      if (
        !resSupplier.data ||
        !resSupplier.data.length ||
        !resShipping.data ||
        !resShipping.data.length
      ) {
        console.warn("Missing supplier or shipping purpose data");
        return;
      }

      const supplierData = resSupplier.data[0];
      const shippingAddrId = resShipping.data[0].id;

      // Check contact list exists
      if (!supplierData.contact_list || !supplierData.contact_list.length) {
        console.warn("Supplier has no contact information");
      } else {
        this.setData({
          supplier_contact_person: `${
            supplierData.contact_list[0].person_name || ""
          } ${supplierData.contact_list[0].person_last_name || ""}`.trim(),
          supplier_contact_number:
            supplierData.contact_list[0].phone_number || "",
          supplier_email: supplierData.contact_list[0].person_email || "",
        });
      }

      const supplierCurrencyId = supplierData.currency_id;

      if (supplierCurrencyId) {
        const resCurrency = await db
          .collection("currency")
          .where({ id: supplierCurrencyId })
          .get();

        const currencyEntry = resCurrency.data[0];
        const currencyCode = currencyEntry.currency_code;
        this.setData({ currency_code: currencyCode });
      }

      // Process addresses
      const addresses =
        supplierData.address_list?.filter(
          (address) => address.switch_save_as_default,
        ) || [];

      // If no addresses found, log a warning
      if (!addresses.length) {
        console.warn("No default addresses found for supplier");
        return;
      }

      console.log(`Found ${addresses.length} addresses for supplier`);

      addresses.forEach(async (address) => {
        let country = "";
        let state = "";

        if (address.address_country_id) {
          const resCountry = await db
            .collection("country")
            .where({ id: address.address_country_id })
            .get();
          country = resCountry?.data[0]?.country_name || "";
        }

        if (address.adddress_state) {
          const resState = await db
            .collection("state")
            .where({ id: address.adddress_state })
            .get();
          state = resState?.data[0]?.state_name || "";
        }

        const isShipping = address.address_purpose_id === shippingAddrId;
        const addressType = isShipping ? "shipping" : "billing";

        const addressTypeUpperCase = isShipping ? "Shipping" : "Billing";

        const addressLines = [
          address.address_line_1,
          address.address_line_2,
          address.address_line_3,
          address.address_line_4,
        ]
          .filter((line) => line)
          .join(
            (
              [
                address.address_line_1,
                address.address_line_2,
                address.address_line_3,
                address.address_line_4,
              ]
                .filter((line) => line)
                .pop() || ""
            ).endsWith(",")
              ? " "
              : ", ",
          );

        const cityDetails = [
          address.address_city,
          address.address_postal_code,
          address.adddress_state ? state : "",
          address.address_country_id ? country : "",
        ]
          .filter((detail) => detail)
          .join(
            (
              [
                address.address_city,
                address.address_postal_code,
                address.adddress_state ? state : "",
                address.address_country_id ? country : "",
              ]
                .filter((detail) => detail)
                .pop() || ""
            ).endsWith(",")
              ? " "
              : ", ",
          );

        const addressAttention = address.address_attention
          ? "\nAttention: " + address.address_attention
          : "";

        const addressPurposeName = `\n${addressTypeUpperCase}` + " Address";

        const addressPersonParts = [
          address.address_name,
          address.address_phone,
        ].filter((part) => part); // Remove undefined or null
        const addressPerson =
          addressPersonParts.length > 0 ? addressPersonParts.join(" | ") : "";

        const formattedAddress = [
          addressPerson,
          addressPurposeName,
          addressLines,
          cityDetails,
          addressAttention,
        ]
          .filter(Boolean)
          .join("\n");

        // Set address fields
        this.setData({
          [`${addressType}_address_line_1`]: address.address_line_1,
          [`${addressType}_address_line_2`]: address.address_line_2,
          [`${addressType}_address_line_3`]: address.address_line_3,
          [`${addressType}_address_line_4`]: address.address_line_4,
          [`${addressType}_address_city`]: address.address_city,
          [`${addressType}_address_state`]: address.adddress_state,
          [`${addressType}_postal_code`]: address.address_postal_code,
          [`${addressType}_address_country`]: address.address_country_id,
          [`${addressType}_address_name`]: address.address_name,
          [`${addressType}_address_phone`]: address.address_phone,
          [`${addressType}_attention`]: address.address_attention,
          [`gr_${addressType}_address`]: formattedAddress,
        });
      });
    } else {
      this.hide("address_grid");
    }
  } catch (error) {
    this.$message.error("Error processing address information:", error);
  }
};

processAddressInformation();
