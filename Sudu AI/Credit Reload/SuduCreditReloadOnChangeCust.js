(async () => {
  try {
    const item = arguments[0]?.fieldModel?.item;
    if (!item) return;

    // Scalars come straight off the selected customer row - no fetch needed.
    this.setData({
      customer_name: item.customer_com_name || '',
      customer_reg_no: item.customer_com_reg_no || '',
      customer_tax_no: item.customer_tin_no || '',
      payment_term: item.customer_payment_term_id || null,
      monthly_remain_before: item.monthly_remain_credit || 0,
      flex_remain_before: item.flex_remain_credit || 0,
    });

    // --- billing address ---------------------------------------------------
    const addressList = item.address_list;

    if (Array.isArray(addressList) && addressList.length > 0) {
      const resBilling = await db
        .collection('address_purpose')
        .where({ purpose_name: 'Billing' })
        .get();

      // address_purpose is a global reference table - a missing row must not throw.
      const billingPurposeId = resBilling?.data?.[0]?.id;

      const billing =
        (billingPurposeId &&
          addressList.find(
            (address) =>
              address.address_purpose_id === billingPurposeId &&
              address.switch_save_as_default
          )) ||
        (billingPurposeId &&
          addressList.find(
            (address) => address.address_purpose_id === billingPurposeId
          )) ||
        addressList[0];

      if (billing) {
        // address_country_id / adddress_state are id-bound selects on this form
        // too, so the raw ids copy across without a name lookup.
        this.setData({
          address_name: billing.address_name || '',
          address_country_id: billing.address_country_id || null,
          adddress_state: billing.adddress_state || null,
          address_line_1: billing.address_line_1 || '',
          address_line_2: billing.address_line_2 || '',
          address_line_3: billing.address_line_3 || '',
          address_line_4: billing.address_line_4 || '',
          address_city: billing.address_city || '',
          address_postal_code: billing.address_postal_code || '',
          address_phone: billing.address_phone || '',
          address_phone2: billing.address_phone2 || '',
          address_mobile: billing.address_mobile || '',
          address_email: billing.address_email || '',
        });
      }
    } else {
      console.warn('Credit Reload: customer row carried no address_list', item);
    }

    // --- currency ----------------------------------------------------------
    // Re-set through '' so currency_id's onChange fires even when the new
    // customer happens to share the previous customer's currency.
    await this.setData({ currency_id: '' });
    await this.setData({ currency_id: item.customer_currency_id || null });
  } catch (error) {
    console.error('Credit Reload: failed to load customer', error);
    this.$message.error('Failed to load customer details.');
  }
})();
