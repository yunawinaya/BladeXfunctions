console.log("arguments", arguments[0]);
const page_status = this.getValue("page_status");

// Check if data is ready and contains purchase_order_id
const checkAndProcessData = async () => {
  console.log("checkAndProcessData for Fake PO");
  const data = this.getValues();

  const purchaseOrderId = this.getValue("fake_purchase_order_id");

  if (!data || !purchaseOrderId) {
    setTimeout(checkAndProcessData, 500);
    return;
  }

  console.log("purchaseOrderId JN", purchaseOrderId);

  if (purchaseOrderId && !Array.isArray(purchaseOrderId)) {
    const supplierData = await db
      .collection("supplier_head")
      .where({ id: arguments[0].fieldModel.item.po_supplier_id })
      .get();

    const supplierContactData = supplierData.data[0].contact_list[0];

    if (supplierContactData) {
      const supplier_contact_person = supplierContactData.person_name;
      const supplier_contact_number = supplierContactData.mobile_number;
      const supplier_email = supplierContactData.person_email;

      await this.setData({
        supplier_contact_person: supplier_contact_person,
        supplier_contact_number: supplier_contact_number,
        supplier_email: supplier_email,
      });
    }

    const poArray = [purchaseOrderId];

    await this.setData({
      currency_code: arguments[0].fieldModel.item.po_currency,
      supplier_id: arguments[0].fieldModel.item.po_supplier_id,
      purchase_order_id: poArray,
    });

    await this.display("purchase_order_id");
    await this.hide("fake_purchase_order_id");
    await this.disabled("plant_id", false);

    await processAddressInformation();
  }
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

// Extract address processing to a separate function
const processAddressInformation = async () => {
  try {
    this.display("address_grid");

    // Reset address fields
    this.setData({
      gr_billing_name: "",
      gr_billing_cp: "",
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
      shipping_address_line_1: "",
      shipping_address_line_2: "",
      shipping_address_line_3: "",
      shipping_address_line_4: "",
      shipping_address_city: "",
      shipping_address_state: "",
      shipping_postal_code: "",
      shipping_address_country: "",
    });

    // If not found, try from arguments
    supplierIdFromPO = arguments[0]?.fieldModel?.item?.po_supplier_id;

    console.log("Using supplier ID for address:", supplierIdFromPO);

    // Get shipping purpose and supplier data concurrently
    const [resShipping, resSupplier] = await Promise.all([
      db
        .collection("address_purpose")
        .where({ purpose_name: "Shipping" })
        .get(),
      db.collection("supplier_head").where({ id: supplierIdFromPO }).get(),
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

    // Set supplier details
    this.setData({
      purchase_order_number: arguments[0]?.fieldModel?.item?.purchase_order_no,
      supplier_name: supplierData.id,
    });

    // Process addresses
    const addresses =
      supplierData.address_list?.filter(
        (address) => address.switch_save_as_default
      ) || [];

    // If no addresses found, log a warning
    if (!addresses.length) {
      console.warn("No default addresses found for supplier");
      return;
    }

    console.log(`Found ${addresses.length} addresses for supplier`);

    addresses.forEach((address) => {
      Promise.all([
        db
          .collection("country")
          .where({ id: address.address_country_id })
          .get(),
        db.collection("state").where({ id: address.adddress_state }).get(),
      ]).then(([resCountry, resState]) => {
        const isShipping = address.address_purpose_id === shippingAddrId;
        const addressType = isShipping ? "shipping" : "billing";
        const country = resCountry.data[0];
        const state = resState.data[0];
        // Set address fields
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

        // Set billing-specific fields
        if (addressType === "billing") {
          this.setData({
            gr_billing_name: address.address_name || "",
            gr_billing_cp: address.address_phone || "",
          });
        }
      });
    });
  } catch (error) {
    this.$message.error("Error processing address information:", error);
  }
};

// Start the process with a check for data readiness
checkAndProcessData();
