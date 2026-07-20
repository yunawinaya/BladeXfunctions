(async () => {
  const RATE_FIELDS = [
    'exchange_rate',
    'exchange_rate_myr',
    'exchange_rate_currency',
    'total_amount_myr',
  ];

  try {
    const currencyId = this.getValue('currency_id');

    if (!currencyId) {
      this.setData({ exchange_rate: 1, exchange_rate_currency: '', exchange_rate_myr: 'MYR' });
      this.hide(RATE_FIELDS);
      this.triggerEvent('func_recalc');
      return;
    }

    const resCurrency = await db.collection('currency').where({ id: currencyId }).get();
    const currencyEntry = resCurrency?.data?.[0];

    if (!currencyEntry) {
      console.warn('Credit Reload: currency not found', currencyId);
      this.triggerEvent('func_recalc');
      return;
    }

    const currencyCode = currencyEntry.currency_code;

    if (currencyCode && currencyCode !== 'MYR' && currencyCode !== '----') {
      // Foreign currency - the buying rate converts document currency into MYR.
      this.setData({
        exchange_rate: currencyEntry.currency_buying_rate || 1,
        exchange_rate_currency: currencyCode,
        exchange_rate_myr: 'MYR',
      });
      this.display(RATE_FIELDS);
    } else {
      // Already base currency - the MYR total would just duplicate total_amount.
      this.setData({
        exchange_rate: 1,
        exchange_rate_currency: currencyCode || '',
        exchange_rate_myr: 'MYR',
      });
      this.hide(RATE_FIELDS);
    }

    this.triggerEvent('func_recalc');
  } catch (error) {
    console.error('Credit Reload: failed to load currency', error);
    this.$message.error('Failed to load currency exchange rate.');
  }
})();
