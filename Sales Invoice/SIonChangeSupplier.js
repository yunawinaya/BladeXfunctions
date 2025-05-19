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
        "address_line_1",
        "address_line_2",
        "address_line_3",
        "address_line_4",
        "address_city",
        "address_state",
        "postal_code",
        "address_country",
      ].forEach((key) => {
        acc[`${type}_${key}`] = "";
      });
      return acc;
    }, {}),
    si_address_name: "",
  });

const formatAddress = async (
  { line1, line2, line3, line4, city, postalCode },
  countryId,
  stateId
) => {
  const [resCountry, resState] = await Promise.all([
    db.collection("country").where({ id: countryId }).get(),
    db.collection("state").where({ id: stateId }).get(),
  ]);
  return [
    line1,
    line2,
    line3,
    line4,
    city,
    postalCode,
    resState.data[0]?.state_name,
    resCountry.data[0]?.country_name,
  ]
    .filter(Boolean)
    .join(",\n");
};

const setAddressFields = async (type, addr) => {
  const formatted = await formatAddress(
    {
      line1: addr.address_line_1,
      line2: addr.address_line_2,
      line3: addr.address_line_3,
      line4: addr.address_line_4,
      city: addr.address_city,
      postalCode: addr.postal_code,
    },
    addr.address_country,
    addr.address_state
  );

  const base = [
    "address_line_1",
    "address_line_2",
    "address_line_3",
    "address_line_4",
    "address_city",
    "address_state",
    "postal_code",
    "address_country",
  ].reduce(
    (acc, key) => {
      acc[`${type}_${key}`] = addr[key];
      return acc;
    },
    { [`si_${type}_address`]: formatted }
  );

  this.setData(base);
};

const init = async () => {
  if (!salesOrderId) return;
  resetFormFields();
  const d = await getDbData();
  const currencyCode = d.so_currency;

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
    db.collection("currency")
      .where({ currency_code: currencyCode })
      .get()
      .then((res) => {
        const currencyEntry = res.data[0];
        this.setData({
          exchange_rate:
            this.getValue("exchange_rate") == undefined
              ? currencyEntry.currency_selling_rate
              : this.getValue("exchange_rate") !=
                currencyEntry.currency_selling_rate
              ? this.getValue("exchange_rate")
              : currencyEntry.currency_selling_rate,
        });

        this.display([
          "exchange_rate",
          "exchange_rate_myr",
          "exchange_rate_currency",
          "myr_total_amount",
          "total_amount_myr",
        ]);
      });
  } else {
    this.setData({
      exchange_rate: 1,
    });
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
    si_address_name: d.cust_billing_name,
    si_address_contact: d.cust_cp,
  };

  const addressFields = ["billing", "shipping"].reduce((acc, type) => {
    [
      "address_line_1",
      "address_line_2",
      "address_line_3",
      "address_line_4",
      "address_city",
      "address_state",
      "postal_code",
      "address_country",
    ].forEach((key) => {
      acc[`${type}_${key}`] = d[`${type}_${key}`];
    });
    return acc;
  }, {});

  this.setData({ ...commonFields, ...addressFields });
  this.display("address_grid");
};

init();
