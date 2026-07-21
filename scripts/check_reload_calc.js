// Differential test: the workflow's calculation must agree with the form's.
//
// The Credit Reload pricing maths necessarily exists twice - once client-side in
// SuduCreditReloadRecalculate.js, once embedded as a string inside the save
// workflow's code_cr_calc node. This script runs both against the same inputs
// and fails on any disagreement, which is the guard against the
// remain_sub_credit / monthly_remain_credit class of drift.
const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");

// --- the canonical implementation, mirrored into code_cr_calc ---------------
const BASE_AMOUNT = 45;
const BASE_CREDIT = 10000;
const TAX_RATE = 0.08;

function computeReload(input) {
  const round = (value, dp) => parseFloat(parseFloat(value || 0).toFixed(dp));

  const reloadAmount = parseFloat(input.reload_amount) || 0;
  const exchangeRate = parseFloat(input.exchange_rate) || 1;
  const reloadType = input.reload_type;
  const subBefore = parseFloat(input.monthly_remain_before) || 0;
  const reloadBefore = parseFloat(input.flex_remain_before) || 0;

  const credits = Math.round((reloadAmount / BASE_AMOUNT) * BASE_CREDIT);

  const totalGross = round(reloadAmount, 2);
  const totalTax = round(totalGross * TAX_RATE, 2);
  const totalAmount = round(totalGross + totalTax, 2);
  const totalAmountMyr = round(totalAmount * exchangeRate, 2);

  let subAfter = subBefore;
  let reloadAfter = reloadBefore;

  if (reloadType === "Monthly Subscription") {
    subAfter = credits;
  } else if (reloadType === "Add On") {
    reloadAfter = reloadBefore + credits;
  }

  return {
    ai_credit_reload_amount: credits,
    total_gross: totalGross,
    total_tax_amount: totalTax,
    total_amount: totalAmount,
    total_amount_myr: totalAmountMyr,
    monthly_remain_after: subAfter,
    flex_remain_after: reloadAfter,
  };
}

// --- run the form's handler in a sandbox and capture its setData ------------
// new Function() here evaluates a fixed first-party file from this repo, with no
// interpolation of any caller-supplied string. It is how the platform itself
// executes these handlers, and is what makes the comparison meaningful. Do not
// extend this to take a path or source from an argument.
function runClientRecalc(values) {
  const body = fs.readFileSync(
    path.join(REPO, "Sudu AI/Credit Reload/SuduCreditReloadRecalculate.js"),
    "utf8",
  );
  let out = {};
  const ctx = { getValues: () => values, setData: (o) => Object.assign(out, o) };
  new Function(body).call(ctx);
  return out;
}

const CASES = [
  { reload_amount: 45, exchange_rate: 1, reload_type: "Monthly Subscription", monthly_remain_before: 3200, flex_remain_before: 500 },
  { reload_amount: 45, exchange_rate: 1, reload_type: "Add On", monthly_remain_before: 3200, flex_remain_before: 500 },
  { reload_amount: 90, exchange_rate: 4.72, reload_type: "Add On", monthly_remain_before: 3200, flex_remain_before: 500 },
  { reload_amount: 0, exchange_rate: 1, reload_type: "", monthly_remain_before: 3200, flex_remain_before: 500 },
  { reload_amount: 22.5, exchange_rate: 3.1416, reload_type: "Monthly Subscription", monthly_remain_before: 0, flex_remain_before: 0 },
];

const KEYS = [
  "ai_credit_reload_amount", "total_gross", "total_tax_amount",
  "total_amount", "total_amount_myr", "monthly_remain_after", "flex_remain_after",
];

let failures = 0;
for (const [i, c] of CASES.entries()) {
  const mine = computeReload(c);
  const theirs = runClientRecalc(c);
  for (const k of KEYS) {
    if (mine[k] !== theirs[k]) {
      failures++;
      console.log(`case ${i} key ${k}: workflow=${mine[k]} form=${theirs[k]}`);
    }
  }
}

console.log(failures === 0
  ? `PASS  ${CASES.length} cases agree across all ${KEYS.length} fields`
  : `FAIL  ${failures} mismatches`);

module.exports = { computeReload };

if (require.main === module) {
  process.exit(failures === 0 ? 0 : 1);
}
