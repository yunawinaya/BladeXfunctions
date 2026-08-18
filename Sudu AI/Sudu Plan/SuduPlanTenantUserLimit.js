// tenant_user_limit is derived, never typed - the tenant gets the most generous
// seat count any of its three plans grants. Bind this one function to the
// onChange of erp_plan_id, ai_service_plan_id and ai_credit_plan_id.
//
// The plan tables live in sudu_billing, so the fallback read has to qualify the
// schema - and a qualified name takes the PHYSICAL table, not the registered
// one. Only reached for a plan row the picker never loaded.
const PLAN_SOURCES = [
  { field: "erp_plan_id", collection: "sudu_billing.sudu_erp_plan" },
  { field: "ai_service_plan_id", collection: "sudu_billing.sudu_ai_service_plan" },
  { field: "ai_credit_plan_id", collection: "sudu_billing.sudu_ai_credit_plan" },
];

(async () => {
  // The picker hands back the whole plan row, so the selected plan's limit is
  // already in memory. Only a row outside the loaded page costs a fetch.
  const limitOf = async (field, collection) => {
    const planId = this.getValue(field);
    if (!planId) return 0;

    const cached = (this.getOptionData(field) || []).find(
      (option) => String(option?.value) === String(planId),
    );

    if (cached?.item) return parseInt(cached.item.tenant_user_limit, 10) || 0;

    const res = await db.collection(collection).where({ id: planId }).get();
    const plan = res?.data?.[0];

    if (!plan) throw new Error(`${collection} ${planId} not found`);

    return parseInt(plan.tenant_user_limit, 10) || 0;
  };

  try {
    // Independent lookups - one round trip, not three.
    const limits = await Promise.all(
      PLAN_SOURCES.map(({ field, collection }) => limitOf(field, collection)),
    );

    // Seeded with 0 so an empty form lands on the column's minimum, not -Infinity.
    this.setData({ tenant_user_limit: Math.max(0, ...limits) });
  } catch (error) {
    // Deliberately leaves the previous value standing. Maxing over a plan that
    // could not be read would quietly hand the tenant fewer seats than it bought.
    console.error("Sudu Plan: could not derive tenant_user_limit", error);
    this.$message.error(
      "Could not read one of the selected plans - User Limit was not updated.",
    );
  }
})();
