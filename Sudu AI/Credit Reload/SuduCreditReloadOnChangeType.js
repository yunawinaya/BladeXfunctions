// Same workflow as Save - it answers a rate probe before any validation.
// Keep in step with SuduCreditReloadSave.js.
const CREDIT_RELOAD_SAVE_WORKFLOW_ID = '2079099954205609985';

// Neither type prefills a standard package any more. Add On is priced per credit
// off Flex Topup Rate and the user types what they are paying; Monthly
// Subscription is priced entirely from the chosen AI Credit Plan and the amount
// is derived, never typed.
(async () => {
  const reloadType = this.getValue('reload_type');

  if (reloadType === 'Monthly Subscription') {
    // The plan sets the price, so the field is display-only.
    this.disabled(['reload_amount'], true);

    const planId = this.getValue('ai_credit_plan');

    if (planId) {
      // Warm the remote select first so its option rows - and therefore
      // fieldModel.item - are resolved before the change fires. Same reason
      // onMounted polls onDropdownVisible for the invoice-rule options. Best
      // effort: if the row still does not resolve the preview shows zero, but
      // the save workflow fetches the plan itself and prices it correctly.
      try {
        await this.onDropdownVisible('ai_credit_plan', true);
      } catch (error) {
        console.warn('Credit Reload: could not warm AI Credit Plan options', error);
      }

      // Re-set through '' so ai_credit_plan's own onChange fires and hands over
      // the plan row - the same forcing trick onChangeCust uses for currency_id.
      // Only that handler receives the row: here we hold the id but not the
      // price, and a remote select's options are not loaded until its dropdown is
      // opened (which is why onMounted has to poll for the invoice-rule options).
      // That handler triggers func_recalc, so this one must not.
      await this.setData({ ai_credit_plan: '' });
      await this.setData({ ai_credit_plan: planId });
      return;
    }

    this.setData({ reload_amount: '' });
    this.triggerEvent('func_recalc');
    return;
  }

  this.disabled(['reload_amount'], false);
  this.setData({ reload_amount: '' });

  if (reloadType !== 'Add On') {
    this.triggerEvent('func_recalc');
    return;
  }

  // sudu_flex_topup sits in a different database, so the form cannot read it -
  // the save workflow resolves it through a probe call. Done here rather than at
  // mount: Monthly Subscription never needs it, a form opened and closed costs
  // nothing, and the amount field is still empty at this point so the round-trip
  // holds nothing up. func_recalc then reads _data and never fetches.
  if (!this.models?.['_data']?.flex_topup_rate) {
    let rate = 0;

    try {
      await this.runWorkflow(
        CREDIT_RELOAD_SAVE_WORKFLOW_ID,
        { data: { action: 'rate' } },
        (result) => {
          rate = parseFloat(result?.data?.flex_topup_rate) || 0;
        },
        (error) => {
          console.error('Credit Reload: Flex Topup Rate probe failed', error);
        }
      );
    } catch (error) {
      console.error('Credit Reload: Flex Topup Rate probe failed', error);
    }

    if (!rate) {
      this.$message.error(
        'Could not load the Flex Topup Rate - Add On credits cannot be priced.'
      );
    }

    // Merged, not assigned - _data is a shared scratch slot on the form instance.
    this.models['_data'] = { ...this.models['_data'], flex_topup_rate: rate };
  }

  this.triggerEvent('func_recalc');
})();
