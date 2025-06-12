const salesOrderId = this.getValue("fake_so_id");

const getDbData = async () => {
  const res = await db
    .collection("sales_order")
    .where({ id: salesOrderId })
    .get();
  return res.data[0];
};

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
      ].forEach((key) => {
        acc[`${type}_${key}`] = "";
      });
      return acc;
    }, {}),
  });

const init = async () => {
  if (!salesOrderId) return;
  resetFormFields();
  const d = await getDbData();
  const currencyCode = d.so_currency;
  const exchangeRate = d.exchange_rate;

  if (!currencyCode) {
    this.hide([
      "exchange_rate",
      "exchange_rate_myr",
      "exchange_rate_currency",
      "myr_total_amount",
      "total_amount_myr",
    ]);
    return;
  }
  this.setData({
    total_gross_currency: currencyCode,
    total_discount_currency: currencyCode,
    total_tax_currency: currencyCode,
    total_amount_currency: currencyCode,
    exchange_rate_currency: currencyCode,
  });
  if (currencyCode != "----" && currencyCode != "MYR") {
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

  const commonFields = {
    sales_person_id: d.so_sales_person
      ? d.so_sales_person
      : this.getValue("sales_person_id"),
    si_payment_term_id: d.so_payment_term,
    so_no_display: d.so_no,
    customer_id: d.customer_name ? d.customer_name : customerName,
    currency_code: currencyCode,
    si_billing_address: d.cust_billing_address,
    si_shipping_address: d.cust_shipping_address,
  };

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
    ].forEach((key) => {
      acc[`${type}_${key}`] = d[`${type}_${key}`];
    });
    return acc;
  }, {});

  this.setData({ ...commonFields, ...addressFields });
  this.display("address_grid");

  const resCustomer = await db
    .collection("Customer")
    .where({ id: d.customer_name })
    .get();

  const customerData = resCustomer.data[0];

  if (
    customerData.is_accurate === 0 &&
    customerData.acc_integration_type !== null
  ) {
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
};

init();
