(async () => {
  try {
    const customerId = arguments[0]?.value;

    // Handle customer ID change
    if (customerId && !Array.isArray(customerId)) {
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

      if (customerData.contact_list && customerData.contact_list.length > 0) {
        await this.setData({
          gd_contact_name: customerData.contact_list[0].person_name,
          contact_number: customerData.contact_list[0].mobile_number,
          email_address: customerData.contact_list[0].person_email,
        });
      }

      const customerCurrencyId = customerData.customer_currency_id;

      console.log("customerCurrencyId", customerCurrencyId);

      if (customerCurrencyId) {
        const resCurrency = await db
          .collection("currency")
          .where({ id: customerCurrencyId })
          .get();

        const currencyEntry = resCurrency.data[0];
        const currencyCode = currencyEntry.currency_code;
        this.setData({ currency_code: currencyCode });
      }
    }
  } catch (error) {
    console.error("Error in customer address processing:", error);
  }
})();
