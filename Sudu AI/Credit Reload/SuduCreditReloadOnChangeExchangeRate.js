(async () => {
  const planId = this.getValue("ai_credit_plan");

  // A subscription's amount is the plan price at this rate, so let the plan
  // handler re-derive it.
  if (this.getValue("reload_type") === "Monthly Subscription" && planId) {
    await this.setData({ ai_credit_plan: "" });
    await this.setData({ ai_credit_plan: planId });
    return;
  }

  this.triggerEvent("func_recalc");
})();
