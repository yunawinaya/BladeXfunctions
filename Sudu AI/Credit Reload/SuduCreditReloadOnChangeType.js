(async () => {
  const reloadType = this.getValue("reload_type");

  if (reloadType === "Monthly Subscription") {
    this.disabled(["reload_amount"], true);

    const planId = this.getValue("ai_credit_plan");

    // Re-set through '' so the plan select hands its row back to
    // onChange_ai_credit_plan, which owns the pricing.
    if (planId) {
      await this.setData({ ai_credit_plan: "" });
      await this.setData({ ai_credit_plan: planId });
      return;
    }

    await this.setData({ reload_amount: "", ai_credit_reload_amount: 0 });
    this.triggerEvent("func_recalc");
    return;
  }

  this.disabled(["reload_amount"], false);
  await this.setData({ reload_amount: "", ai_credit_reload_amount: 0 });

  if (reloadType !== "Add On") {
    this.triggerEvent("func_recalc");
    return;
  }

  // Fetched once per form and parked in _data - func_recalc runs on every
  // keystroke and must not fetch.
  if (!this.models?.["_data"]?.flex_topup_rate) {
    let rate = 0;

    try {
      const resRate = await db
        .collection("sudu_billing.sudu_flex_topup")
        .where({ is_deleted: 0 })
        .get();

      rate = parseFloat(resRate?.data?.[0]?.flex_topup_rate) || 0;
    } catch (error) {
      console.error("Credit Reload: failed to load Flex Topup Rate", error);
    }

    if (!rate) {
      this.$message.error(
        "Could not load the Flex Topup Rate - Add On credits cannot be priced.",
      );
    }

    this.models["_data"] = { ...this.models["_data"], flex_topup_rate: rate };
  }

  this.triggerEvent("func_recalc");
})();
