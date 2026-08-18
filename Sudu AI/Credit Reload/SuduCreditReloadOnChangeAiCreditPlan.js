// The only place a Monthly Subscription is priced. Both figures go into real
// form fields so func_recalc can read them back instead of recomputing them.
(async () => {
  if (this.getValue("reload_type") !== "Monthly Subscription") return;

  const plan = arguments[0]?.fieldModel?.item;
  const priceMyr = parseFloat(plan?.monthly_price_rm) || 0;
  const credits = parseFloat(plan?.monthly_credit_amount) || 0;
  const exchangeRate = parseFloat(this.getValue("exchange_rate")) || 1;

  if (!(priceMyr > 0 && credits > 0)) {
    await this.setData({ reload_amount: "", ai_credit_reload_amount: 0 });
    this.triggerEvent("func_recalc");
    return;
  }

  // monthly_price_rm is MYR, so it divides back into the document currency.
  const amount =
    Math.floor(parseFloat(((priceMyr / exchangeRate) * 100).toPrecision(12))) / 100;

  await this.setData({
    reload_amount: amount,
    ai_credit_reload_amount: credits,
  });

  this.triggerEvent("func_recalc");
})();
