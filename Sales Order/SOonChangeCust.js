(async () => {
  //this.showLoading();

  console.log("arguments", arguments[0]);

  const customerId = this.getValue("customer_name");
  const customerChangeId = this.getValue("customer_change_id");
  console.log("customerId", customerId);
  console.log("customerChangeId", customerChangeId);

  let customerData;
  let customerCurrencyId;
  let customerPaymentTermId;

  if (customerId && !Array.isArray(customerId)) {
    customerData = await db
      .collection("Customer")
      .where({ id: customerId })
      .get()
      .then((res) => {
        return res.data[0];
      });

    customerCurrencyId = customerData.customer_currency_id;
    customerPaymentTermId = customerData.customer_payment_term_id;
  }

  console.log("customerCurrencyId", customerCurrencyId);
  console.log("customerPaymentTermId", customerPaymentTermId);

  // Fetch currency data
  if (customerCurrencyId) {
    const resCurrency = await db
      .collection("currency")
      .where({ id: customerCurrencyId })
      .get();

    const currencyEntry = resCurrency.data[0];
    const currencyCode = currencyEntry.currency_code;
    this.setData({ so_currency: currencyCode });

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
        this.setData({ exchange_rate: currencyEntry.currency_buying_rate });

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
  }

  // Set payment term
  if (customerPaymentTermId) {
    this.setData({
      so_payment_term: customerPaymentTermId,
    });
  }

  // Address handling
  if (
    customerId &&
    (!customerChangeId || customerChangeId !== customerId) &&
    !Array.isArray(customerId)
  ) {
    console.log("passing JN");
    this.setData({ customer_change_id: customerId });
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

    resetFormFields();

    const resCustomer = await db
      .collection("Customer")
      .where({ id: customerId })
      .get();
    if (resCustomer.data.length === 0) return;

    const customerData = resCustomer.data[0];
    const addresses = customerData.address_list?.filter(
      (address) => address.switch_save_as_default
    );

    for (const address of addresses) {
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
        resCountry.data.length === 0 ||
        resState.data.length === 0 ||
        resShipping.data.length === 0
      )
        continue;

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
      const isShipping = address.address_purpose_id === shippingAddrId;
      const addressType = isShipping ? "shipping" : "billing";
      setDialogAddressFields(
        addressType,
        address,
        resState.data[0].id,
        resCountry.data[0].id
      );

      if (addressType === "shipping") {
        this.setData({ cust_shipping_address: formattedAddress });
      } else {
        this.setData({
          cust_billing_address: formattedAddress,
          cust_billing_name: address.address_name,
          cust_cp: address.address_phone,
        });
      }
    }
    //this.hideLoading();

    /*this.showLoading()
    this.runWorkflow('1902566784276480001', {
      "CODE": customerData.customer_id,
      "DOCUMENT": "so"
    },
      (res) => { //success
        const { data: { result: [{ BLOCK_STATUS, TOTAL_OUTSTANDING, REMAINING_AMOUNT }] } } = res;
        if (BLOCK_STATUS == 1) {
          this.setData({
            total_allowed_amount: REMAINING_AMOUNT,
            total_outstanding_amount: TOTAL_OUTSTANDING
          })
          this.openDialog('dialog_credit_limit')

        }
        this.hideLoading()
      },

      async (err) => { //err
        const { data: [{ remaining_amount, total_outstanding, is_exceed_limit }] } = await db.collection('Customer').where({ id: customerData.id }).get()
        if (is_exceed_limit == 1) {
          this.setData({
            total_allowed_amount: remaining_amount,
            total_outstanding_amount: total_outstanding
          })
          this.openDialog('dialog_credit_limit')
        }

        this.hideLoading()
      })*/
  }
})();
