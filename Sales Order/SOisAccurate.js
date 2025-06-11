(async () => {
  try {
    const customer_id = this.getValue("customer_name");
    this.showLoading();
    await this.runWorkflow(
      "1902566784276480001",
      { cust_id: customer_id, is_single: 1 },
      async (res) => {
        console.log("成功结果：", res);
      },
      (err) => {
        console.error("失败结果：", err);
      }
    );

    await db
      .collection("Customer")
      .where({ id: customer_id })
      .then((res) => {
        const customerData = res.data[0];
        if (customerData) {
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
      });

    this.hideLoading();
    this.$message.success("Sync customer successfully");
  } catch (error) {
    console.error("Error in main execution:", error);
    this.hideLoading();
    this.$message.error("An error occurred while sync customer");
  }
})();
