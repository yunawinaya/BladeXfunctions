// Wire to the ai_credit_plan select's onChange.
//
// The chosen plan row arrives on the event, so nothing is fetched here - the AI
// Credit Plan table sits in a different database and the form cannot query it
// directly. Price and credits are parked in _data for func_recalc, which fires on
// every keystroke and must stay fetch-free.
const plan = arguments[0]?.fieldModel?.item;

this.models['_data'] = {
  ...this.models['_data'],
  // monthly_price_rm is MYR by definition; func_recalc divides it back into the
  // document currency. monthly_credit_amount is the grant, taken as given rather
  // than recomputed from effective_rm_per_credit.
  ai_plan_price_myr: parseFloat(plan?.monthly_price_rm) || 0,
  ai_plan_credits: parseFloat(plan?.monthly_credit_amount) || 0,
};

if (!plan) {
  console.warn('Credit Reload: AI Credit Plan cleared or carried no row');
}

this.triggerEvent('func_recalc');
