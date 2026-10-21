const resetFormFields = () =>
  this.setData({
    ...["billing", "shipping"].reduce((acc, type) => {
      [
        "address_name",
        "address_phone",
        "address_line_1",
        "address_line_2",
        "address_line_3",
        "address_line_4",
        "address_city",
        "address_state",
        "postal_code",
        "address_country",
        "attention",
        "address_fax",
        "address_code",
      ].forEach((key) => {
        acc[`${type}_${key}`] = "";
      });
      return acc;
    }, {}),
  });

(async () => {
  const soID = this.getValue("so_id");

  if (soID.length > 0) {
    const resSO = await db
      .collection("sales_order")
      .where({ id: soID[0] })
      .get();
    console.log("resSO", resSO);

    await resetFormFields();

    const addressFields = ["billing", "shipping"].reduce((acc, type) => {
      [
        "address_name",
        "address_phone",
        "address_line_1",
        "address_line_2",
        "address_line_3",
        "address_line_4",
        "address_city",
        "address_state",
        "postal_code",
        "address_country",
        "attention",
        "address_fax",
        "address_code",
      ].forEach((key) => {
        acc[`${type}_${key}`] = resSO.data[0][`${type}_${key}`];
      });
      return acc;
    }, {});

    this.setData({
      si_payment_term_id: resSO.data[0].so_payment_term || null,
      sales_person_id: resSO.data[0].so_sales_person || null,
      agent_user_id: resSO.data[0].so_agent_user_id || null,
      exchange_rate: resSO.data[0].exchange_rate,
      si_area_id: resSO.data[0].so_area_id || null,
      currency_code: resSO.data[0].so_currency,
      si_billing_address: resSO.data[0].cust_billing_address,
      si_shipping_address: resSO.data[0].cust_shipping_address,
      tnc: resSO.data[0].so_tnc,
      payment_term: resSO.data[0].so_payment_details,
      delivery_term: resSO.data[0].so_delivery_term,
      remarks: resSO.data[0].so_remarks,
      remarks2: resSO.data[0].so_remarks2,
      remarks3: resSO.data[0].so_remarks3,
      remarks4: resSO.data[0].so_remarks4,
      remarks5: resSO.data[0].so_remarks5,
      project_id: resSO.data[0].project_id,
      si_description: resSO.data[0].so_description || 'Sales',
      ...addressFields,
    });

    this.display("address_grid");

    const currencyCode = resSO.data[0].so_currency;

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
  }
})();
