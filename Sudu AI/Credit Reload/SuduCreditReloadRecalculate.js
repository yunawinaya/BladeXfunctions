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
const subBefore = parseFloat(data.monthly_remain_before) || 0;
const reloadBefore = parseFloat(data.flex_remain_before) || 0;

// Credits scale linearly with the amount paid, and are read off the GROSS amount
// on purpose - a discount is a price concession, not a smaller top-up (same as
// SO, where so_discount never touches so_quantity). ai_credit_reload_amount is
// an int column (precision 0), so round rather than truncate.
const credits = Math.round((reloadAmount / BASE_AMOUNT) * BASE_CREDIT);

const totalGross = round(reloadAmount, 2);

// Discount mirrors SOcalculation.js: a bare value defaults to Amount, and a
// value the gross cannot absorb is reset to zero rather than raising an error.
// The negative reset is an addition - total_discount is a positive-money column,
// so a negative would both inflate total_amount and be rejected on write.
let discount = parseFloat(data.reload_discount) || 0;
let discountUom = data.reload_discount_uom;
let discountAmount = 0;
let uomDefaulted = false;
let discountReset = false;

if (discount < 0) {
  discount = 0;
  discountReset = true;
}

if (discount > 0 && !discountUom) {
  discountUom = 'Amount';
  uomDefaulted = true;
}

if (discountUom && discount > 0) {
  discountAmount =
    discountUom === '%' ? round((totalGross * discount) / 100, 2) : round(discount, 2);
}

if (discountAmount > totalGross) {
  discount = 0;
  discountAmount = 0;
  discountReset = true;
}

// Tax is exclusive - added on top of the amount left after the discount.
const afterDiscount = round(totalGross - discountAmount, 2);
const totalTax = round(afterDiscount * TAX_RATE, 2);
const totalAmount = round(afterDiscount + totalTax, 2);
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

const updates = {
  ai_credit_reload_amount: credits,
  total_gross: totalGross,
  total_discount: discountAmount,
  total_tax_amount: totalTax,
  total_amount: totalAmount,
  total_amount_myr: totalAmountMyr,
  monthly_remain_after: subAfter,
  flex_remain_after: reloadAfter,
};

// The two entry fields are written back only when this function actually changed
// them - echoing every keystroke back into the inputs fights the caret.
if (uomDefaulted) {
  updates.reload_discount_uom = discountUom;
}

if (discountReset) {
  updates.reload_discount = 0;
}

this.setData(updates);
