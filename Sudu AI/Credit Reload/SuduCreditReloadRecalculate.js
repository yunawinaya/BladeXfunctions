// Single source of truth for every computed amount on this form.
// Pricing is hardcoded for now - BASE_AMOUNT of document currency buys BASE_CREDIT credits.
const BASE_AMOUNT = 45;
const BASE_CREDIT = 10000;
const TAX_RATE = 0.08;

const round = (value, dp) => parseFloat(parseFloat(value || 0).toFixed(dp));

const data = this.getValues();

const reloadAmount = parseFloat(data.reload_amount) || 0;
const exchangeRate = parseFloat(data.exchange_rate) || 1;
const reloadType = data.reload_type;
const subBefore = parseFloat(data.sub_remain_before) || 0;
const reloadBefore = parseFloat(data.reload_remain_before) || 0;

// Credits scale linearly with the amount paid. ai_credit_reload_amount is an
// int column (precision 0), so round rather than truncate.
const credits = Math.round((reloadAmount / BASE_AMOUNT) * BASE_CREDIT);

// Tax is exclusive - added on top of the entered amount.
const totalGross = round(reloadAmount, 2);
const totalTax = round(totalGross * TAX_RATE, 2);
const totalAmount = round(totalGross + totalTax, 2);
const totalAmountMyr = round(totalAmount * exchangeRate, 2);

// Monthly Subscription RESETS the subscription balance to the purchased credits,
// ignoring whatever was left. Add On accumulates onto the reload balance.
// Anything else leaves both balances untouched.
let subAfter = subBefore;
let reloadAfter = reloadBefore;

if (reloadType === 'Monthly Subscription') {
  subAfter = credits;
} else if (reloadType === 'Add On') {
  reloadAfter = reloadBefore + credits;
}

this.setData({
  ai_credit_reload_amount: credits,
  total_gross: totalGross,
  total_tax_amount: totalTax,
  total_amount: totalAmount,
  total_amount_myr: totalAmountMyr,
  sub_remain_after: subAfter,
  reload_remain_after: reloadAfter,
});
