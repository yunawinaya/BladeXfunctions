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

      if (
        customerData.is_accurate === 0 &&
        customerData.acc_integration_type !== null &&
        customerData.control_type_list.some(
          (control) => control.document_type === "Goods Delivery"
        )
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
    }
  } catch (error) {
    console.error("Error in customer address processing:", error);
  }
})();
