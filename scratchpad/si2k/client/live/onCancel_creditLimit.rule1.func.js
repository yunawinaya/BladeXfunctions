(async () => {
  try {
    this.hide([
      "dialog_credit_limit.alert_credit_limit",
      "dialog_credit_limit.alert_overdue_limit",
      "dialog_credit_limit.alert_credit_overdue",
      "dialog_credit_limit.alert_suspended",
      "dialog_credit_limit.text_credit_limit",
      "dialog_credit_limit.text_overdue_limit",
      "dialog_credit_limit.text_credit_overdue",
      "dialog_credit_limit.text_suspended",
      "dialog_credit_limit.total_allowed_credit",
      "dialog_credit_limit.total_credit",
      "dialog_credit_limit.total_allowed_overdue",
      "dialog_credit_limit.total_overdue",
      "dialog_credit_limit.text_1",
      "dialog_credit_limit.text_2",
      "dialog_credit_limit.text_3",
      "dialog_credit_limit.text_4",
      "dialog_credit_limit.button_back",
      "dialog_credit_limit.button_no",
      "dialog_credit_limit.button_yes",
    ]);
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
