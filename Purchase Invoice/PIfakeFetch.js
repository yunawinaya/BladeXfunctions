const data = this.getValues();
const currencyCode = arguments[0].fieldModel.item.po_currency;
const exchangeRate = arguments[0].fieldModel.item.exchange_rate;
this.setData({
  currency_code: currencyCode,
  supplier_name: arguments[0].fieldModel.item.po_supplier_id,
  plant_id: arguments[0].fieldModel.item.po_plant,
  organization_id: arguments[0].fieldModel.item.organization_id,
  invoice_payment_term_id: arguments[0].fieldModel.item.po_payment_terms,
  po_no_display: arguments[0].fieldModel.item.purchase_order_no,
  goods_receiving_no: [],
  table_pi: [],
});

// Check if purchase_order_id has a value
const purchaseOrderId = data.fake_purchase_order_id;
if (!purchaseOrderId) {
  return;
}

// Address
if (purchaseOrderId) {
  this.display("address_grid");
  const resetFormFields = () => {
    this.setData({
      pi_billing_name: "",
      pi_billing_cp: "",
      pi_shipping_address: "",
      pi_billing_address: "",
      billing_address_line_1: "",
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

  const setAddressFields = (addressType, address) => {
    this.setData({
      [`${addressType}_address_line_1`]: address.address_line_1,
      [`${addressType}_address_line_2`]: address.address_line_2,
      [`${addressType}_address_line_3`]: address.address_line_3,
      [`${addressType}_address_line_4`]: address.address_line_4,
      [`${addressType}_address_city`]: address.address_city,
      [`${addressType}_address_state`]: address.adddress_state,
      [`${addressType}_postal_code`]: address.address_postal_code,
      [`${addressType}_address_country`]: address.address_country_id,
    });
  };

  resetFormFields();

  const supplierIdFromPO = arguments[0]?.fieldModel?.item?.po_supplier_id;

  if (supplierIdFromPO) {
    Promise.all([
      db
        .collection("address_purpose")
        .where({ purpose_name: "Shipping" })
        .get(),
      db.collection("supplier_head").where({ id: supplierIdFromPO }).get(),
    ]).then(async ([resShipping, resSupplier]) => {
      if (resSupplier.data.length === 0 || resShipping.data.length === 0)
        return;

      const supplierData = resSupplier.data[0];
      const shippingAddrId = resShipping.data[0].id;

      const addresses = supplierData.address_list.filter(
        (address) => address.switch_save_as_default
      );

      await this.display("purchase_order_id");
      await this.hide("fake_purchase_order_id");
      const poArray = [purchaseOrderId];
      await this.setData({
        supplier_name: supplierData.id,
        agent_id: supplierData.supplier_agent_id,
        purchase_order_id: poArray,
        testing_po: poArray,
      });

      addresses.forEach((address) => {
        Promise.all([
          db
            .collection("country")
            .where({ id: address.address_country_id })
            .get(),
          db.collection("state").where({ id: address.adddress_state }).get(),
        ]).then(([resCountry, resState]) => {
          if (resCountry.data.length === 0 || resState.data.length === 0)
            return;

          const countryName = resCountry.data[0].country_name;
          const stateName = resState.data[0].state_name;

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

          const isShipping = address.address_purpose_id === shippingAddrId;
          const addressType = isShipping ? "shipping" : "billing";

          setAddressFields(
            addressType,
            address,
            resState.data[0].id,
            resCountry.data[0].id
          );

          if (addressType === "shipping") {
            this.setData({ pi_shipping_address: formattedAddress });
          } else {
            this.setData({
              pi_billing_address: formattedAddress,
              pi_billing_name: address.address_name,
              pi_billing_cp: address.address_phone,
            });
          }
        });
      });
    });
  }
}

if (!currencyCode) {
  this.hide([
    "exchange_rate",
    "exchange_rate_myr",
    "exchange_rate_currency",
    "myr_total_amount",
    "total_amount_myr",
  ]);
  return;
} else {
  this.setData({
    total_gross_currency: currencyCode,
    total_discount_currency: currencyCode,
    total_tax_currency: currencyCode,
    total_amount_currency: currencyCode,
    exchange_rate_currency: currencyCode,
  });

  if (currencyCode !== "----" && currencyCode !== "MYR") {
    this.setData({ exchange_rate: exchangeRate });
    this.display([
      "exchange_rate",
      "exchange_rate_myr",
      "exchange_rate_currency",
      "myr_total_amount",
      "total_amount_myr",
    ]);
  } else {
    this.setData({ exchange_rate: 1 });
    this.hide([
      "exchange_rate",
      "exchange_rate_myr",
      "exchange_rate_currency",
      "myr_total_amount",
      "total_amount_myr",
    ]);
  }
}
