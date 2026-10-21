(async () => {
  const resCustomer = await db
    .collection("Customer")
    .where({ id: arguments[0].value })
    .get();

  const customerData = resCustomer.data[0];

  if (customerData.is_accurate === 0) {
    this.openDialog("dialog_accurate");
  }

  this.setData({
    last_sync_date: customerData.last_sync_date,
    customer_credit_limit: customerData.customer_credit_limit,
    overdue_limit: customerData.overdue_limit,
    outstanding_balance: customerData.outstanding_balance,
    overdue_inv_total_amount: customerData.overdue_inv_total_amount,
    is_accurate: customerData.is_accurate,
  });
})();
