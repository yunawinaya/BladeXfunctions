// Same workflow as Save - it answers a rate probe before any validation.
// Keep in step with SuduCreditReloadSave.js.
const CREDIT_RELOAD_SAVE_WORKFLOW_ID = '2079099954205609985';

// Add On is priced per credit off Flex Topup Rate, so there is no standard
// package to prefill - the user enters whatever they are paying. Monthly
// Subscription keeps the legacy package until AI Credit Plan is wired up; keep
// the 45 in step with BASE_AMOUNT in func_recalc.
(async () => {
  const reloadType = this.getValue('reload_type');

  if (reloadType !== 'Add On') {
    this.setData({ reload_amount: 45 });
    this.triggerEvent('func_recalc');
    return;
  }

  this.setData({ reload_amount: '' });

  // sudu_flex_topup sits in a different database, so the form cannot read it -
  // the save workflow resolves it through a probe call. Done here rather than at
  // mount: Monthly Subscription never needs it, a form opened and closed costs
  // nothing, and the amount field is still empty at this point so the round-trip
  // holds nothing up. func_recalc then reads _data and never fetches, which
  // matters because it fires on every keystroke in the amount field.
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
