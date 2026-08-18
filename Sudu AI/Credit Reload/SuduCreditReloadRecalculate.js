// Single source of truth for every computed amount on this form. Neither type is
// hardcoded: Add On is priced off Flex Topup Rate, Monthly Subscription off the
// chosen AI Credit Plan. Both arrive through _data - see the note below.
const TAX_RATE = 0.08;

// Every amount rounds DOWN, never up - 1.77779 lands on 1.7777, not 1.7778.
// Flooring the scaled value alone is not enough: 8.2 * 100 is 819.9999999999999
// in binary float and would truncate 8.20 down to 8.19. toPrecision(12) rubs out
// that representation noise while leaving a genuine 8.1999 untouched.
const roundDown = (value, dp) => {
  const factor = Math.pow(10, dp);
  const scaled = parseFloat(((parseFloat(value) || 0) * factor).toPrecision(12));
  return Math.floor(scaled) / factor;
};

const data = this.getValues();

let reloadAmount = parseFloat(data.reload_amount) || 0;
const exchangeRate = parseFloat(data.exchange_rate) || 1;
const reloadType = data.reload_type;
const subBefore = parseFloat(data.monthly_remain_before) || 0;
const reloadBefore = parseFloat(data.flex_remain_before) || 0;

// Credits scale linearly with the amount paid, and are read off the GROSS amount
// on purpose - a discount is a price concession, not a smaller top-up (same as
// SO, where so_discount never touches so_quantity). ai_credit_reload_amount is
// an int column (precision 0), and a part-credit is never granted.
//
// Both prices live in _data, never fetched here: this function runs on every
// keystroke in the amount field, and neither source table is readable from the
// form anyway - they sit in a different database. onChange_reload_type probes the
// save workflow for the Flex rate; onChange_ai_credit_plan takes the plan figures
// straight off its own event.
//
// Named branches, not a default - an unrecognised type must grant nothing rather
// than quietly price as one of the two known ones. A missing price previews as
// zero credits; the save workflow refuses the document outright, so nothing here
// can become a real credit grant.
let credits = 0;
let amountDerived = false;

if (reloadType === 'Add On') {
  // flex_topup_rate is MYR per credit, so the amount crosses the exchange rate
  // before dividing - a USD 45 reload must not buy the same credits as MYR 45.
  const flexRate = parseFloat(this.models?.['_data']?.flex_topup_rate) || 0;
  const amountMyr = roundDown(reloadAmount * exchangeRate, 2);

  if (flexRate > 0) {
    credits = roundDown(amountMyr / flexRate, 0);
  } else {
    console.warn('Credit Reload: Add On priced without a Flex Topup Rate');
  }
} else if (reloadType === 'Monthly Subscription') {
  // The plan is the only authority on what a subscription costs and grants, so
  // the amount is derived here rather than typed. Deriving it in this function
  // rather than in the plan's own handler means a currency change re-prices too.
  const planPrice = parseFloat(this.models?.['_data']?.ai_plan_price_myr) || 0;
  const planCredits = parseFloat(this.models?.['_data']?.ai_plan_credits) || 0;

  if (planPrice > 0 && planCredits > 0) {
    // monthly_price_rm is MYR by definition, so it divides back into document
    // currency and total_amount_myr lands on the plan price again.
    reloadAmount = roundDown(planPrice / exchangeRate, 2);
    credits = planCredits;
    amountDerived = true;
  } else {
    console.warn('Credit Reload: Monthly Subscription priced without a plan');
  }
}

const totalGross = roundDown(reloadAmount, 2);

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

// reload_discount is stored to 4 dp - truncate at the same precision the save
// workflow writes, so what is priced here is what ends up on the record.
discount = roundDown(discount, 4);

if (discount > 0 && !discountUom) {
  discountUom = 'Amount';
  uomDefaulted = true;
}

// Named branches, not a ternary with an Amount fallback - an unexpected type must
// price as nothing rather than quietly as an Amount.
if (discount > 0) {
  if (discountUom === '%') {
    discountAmount = roundDown((totalGross * discount) / 100, 2);
  } else if (discountUom === 'Amount') {
    discountAmount = roundDown(discount, 2);
  }
}

if (discountAmount > totalGross) {
  discount = 0;
  discountAmount = 0;
  discountReset = true;
}

// Tax is exclusive - added on top of the amount left after the discount.
const afterDiscount = roundDown(totalGross - discountAmount, 2);
const totalTax = roundDown(afterDiscount * TAX_RATE, 2);
const totalAmount = roundDown(afterDiscount + totalTax, 2);
const totalAmountMyr = roundDown(totalAmount * exchangeRate, 2);

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

// Only Monthly Subscription derives the amount, and its field is disabled, so
// this never fights a caret the way echoing a typed Add On amount would.
if (amountDerived) {
  updates.reload_amount = reloadAmount;
}

this.setData(updates);
