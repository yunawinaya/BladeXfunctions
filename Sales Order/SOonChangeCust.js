const customerItem = arguments[0]?.fieldModel?.item;
const customerId = customerItem?.id;

if (customerId && !Array.isArray(customerId)) {
  this.display("address_grid");

  const resetFormFields = () => {
    this.setData({
      cust_billing_name: "",
      cust_billing_cp: "",
      cust_billing_address: "",
      cust_shipping_address: "",
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
    });
  };

  const setDialogAddressFields = (addressType, address) => {
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
                      so_currency: currencyCode,
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
                      so_currency: currencyCode,
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
            so_payment_term: customerData.customer_payment_term_id,
          });
        }

        if (customerData.customer_agent_id) {
          this.setData({
            so_sales_person: customerData.customer_agent_id,
          });
        }

        const addresses =
          customerData.address_list?.filter(
            (address) => address.switch_save_as_default
          ) || [];

        addresses.forEach(async (address) => {
          let country = "";
          let state = "";

          const resShipping = await db
            .collection("address_purpose")
            .where({ purpose_name: "Shipping" })
            .get();
          const shippingAddrId = resShipping.data[0].id;
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
                : ", "
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
                : ", "
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

          setDialogAddressFields(addressType, address);

          if (addressType === "shipping") {
            this.setData({
              cust_shipping_address: formattedAddress,
            });
          } else {
            this.setData({
              cust_billing_address: formattedAddress,
            });
          }
        });

        if (customerData.is_accurate === 0) {
          this.openDialog("dialog_accurate");
        }

        this.setData({
          acc_integration_type: customerData.acc_integration_type,
          last_sync_date: customerData.last_sync_date,
          customer_credit_limit: customerData.customer_credit_limit,
          overdue_limit: customerData.overdue_limit,
          outstanding_balance: customerData.outstanding_balance,
          overdue_inv_total_amount: customerData.overdue_inv_total_amount,
          is_accurate: customerData.is_accurate,
        });
      }
    })
    .catch((error) => {
      console.error("Error fetching customer:", error);
    });
}
