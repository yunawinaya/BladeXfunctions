(async () => {
  try {
    const customer_id = this.getValue("customer_id");
    this.showLoading();
    await this.runWorkflow(
      "1958732352162164738",
      { key: "value" },
      async (res) => {
        console.log("成功结果：", res);
        if (res.data.status === "running") {
          await this.runWorkflow(
            "1932646874203521025",
            { cust_id: customer_id, cust_credit_limit: "True" },
            async (res) => {
              console.log("成功结果：", res);
            },
            (err) => {
              console.error("失败结果：", err);
              throw new Error(
                "Your SQL accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists."
              );
            }
          );
        }
      },
      (err) => {
        console.log("失败结果：", err);

        this.hideLoading();
        throw new Error(
          "Your SQL accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists."
        );
      }
    );

    await db
      .collection("Customer")
      .where({ id: customer_id })
      .get()
      .then((res) => {
        const customerData = res.data[0];
        if (customerData) {
          this.setData({
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
    this.$message.error(error.toString());
  }
})();
