const customerItem = arguments[0]?.fieldModel?.item;
const customerId = customerItem?.id || this.getValue("sqt_customer_id");

if (customerId && !Array.isArray(customerId)) {
  this.display("address_grid");

  const resetFormFields = () => {
    this.setData({
      sqt_billing_name: "",
      sqt_billing_cp: "",
      sqt_billing_address: "",
      sqt_shipping_address: "",
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

  const setDialogAddressFields = (addressType, address, stateId, countryId) => {
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

  resetFormFields();

  db.collection("Customer")
    .where({ id: customerId })
    .get()
    .then((resCustomer) => {
      if (resCustomer?.data && resCustomer.data.length > 0) {
        const customerData = resCustomer.data[0];

        if (customerData.customer_currency_id) {
          db.collection("currency")
            .where({ id: customerData.customer_currency_id })
            .get()
            .then((resCurrency) => {
              if (resCurrency?.data && resCurrency.data.length > 0) {
                const currencyEntry = resCurrency.data[0];
                const currencyCode = currencyEntry.currency_code;
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
                    this.setData({
                      exchange_rate: currencyEntry.currency_buying_rate,
                      currency_code: currencyCode,
                    });

                    this.display([
                      "exchange_rate",
                      "exchange_rate_myr",
                      "exchange_rate_currency",
                      "myr_total_amount",
                      "total_amount_myr",
                    ]);
                  } else {
                    this.setData({
                      exchange_rate: 1,
                      currency_code: currencyCode,
                    });
                    this.hide([
                      "exchange_rate",
                      "exchange_rate_myr",
                      "exchange_rate_currency",
                      "myr_total_amount",
                      "total_amount_myr",
                    ]);
                  }
                }
              }
            })
            .catch((error) => {
              console.error("Error fetching currency:", error);
            });
        }

        if (customerData.customer_payment_term_id) {
          this.setData({
            sqt_payment_term: customerData.customer_payment_term_id,
          });
        }

        const addresses =
          customerData.address_list?.filter(
            (address) => address.switch_save_as_default
          ) || [];

        addresses.forEach((address) => {
          Promise.all([
            db
              .collection("country")
              .where({ id: address.address_country_id })
              .get(),
            db.collection("state").where({ id: address.adddress_state }).get(),
            db
              .collection("address_purpose")
              .where({ purpose_name: "Shipping" })
              .get(),
          ])
            .then(([resCountry, resState, resShipping]) => {
              if (
                resCountry?.data &&
                resCountry.data.length > 0 &&
                resState?.data &&
                resState.data.length > 0 &&
                resShipping?.data &&
                resShipping.data.length > 0
              ) {
                const countryName = resCountry.data[0].country_name;
                const stateName = resState.data[0].state_name;
                const shippingAddrId = resShipping.data[0].id;

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

                const isShipping =
                  address.address_purpose_id === shippingAddrId;
                const addressType = isShipping ? "shipping" : "billing";

                setDialogAddressFields(
                  addressType,
                  address,
                  resState.data[0].id,
                  resCountry.data[0].id
                );

                if (addressType === "shipping") {
                  this.setData({
                    sqt_shipping_address: formattedAddress,
                  });
                } else {
                  this.setData({
                    sqt_billing_address: formattedAddress,
                    sqt_billing_name: address.address_name,
                    sqt_billing_cp: address.address_phone,
                  });
                }
              }
            })
            .catch((error) => {
              console.error("Error processing address:", error);
            });
        });
      }
    })
    .catch((error) => {
      console.error("Error fetching customer:", error);
    });
}
