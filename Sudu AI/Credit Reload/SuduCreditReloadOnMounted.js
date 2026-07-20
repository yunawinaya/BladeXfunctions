const INVOICE_RULE_FIELD = 'reload_invoice_no_type';

// Locked once the document exists. Edit mode exists only to settle payment
// (Unpaid -> Paid), so everything that defines the document itself is frozen.
const LOCKED_ON_EDIT = [
  'reload_invoice_no',
  'reload_invoice_no_type',
  'reload_date',
  'tenant_2',
  'reload_type',
  'currency_id',
  'exchange_rate',
  'reload_amount',
];

const PAYMENT_FIELDS = [
  'payment_status',
  'payment_term',
  'payment_method',
  'payment_date',
];

// Local calendar date. Deliberately not toISOString(), which is UTC and would
// hand back yesterday for a UTC+8 user working between midnight and 08:00.
const todayLocal = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};

// The invoice-number rule dropdown populates asynchronously - poll until the
// component reports its options, then apply the default rule.
const setupInvoiceRule = async () => {
  const maxRetries = 10;
  const interval = 500;

  for (let i = 0; i < maxRetries; i++) {
    const op = await this.onDropdownVisible(INVOICE_RULE_FIELD, true);
    if (op != null) break;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  const getDefaultItem = (arr) => arr?.find((item) => item?.item?.is_default === 1);

  const params = this.getComponent('reload_invoice_no');
  const { options } = params;

  const optionsData = this.getOptionData(INVOICE_RULE_FIELD) || [];
  const defaultData = getDefaultItem(optionsData);

  if (options?.canManualInput) {
    this.setOptionData(INVOICE_RULE_FIELD, [
      { label: 'Manual Input', value: -9999 },
      ...optionsData,
    ]);

    if (this.isAdd) {
      this.setData({
        [INVOICE_RULE_FIELD]: defaultData ? defaultData.value : -9999,
      });
    }
  } else if (defaultData && this.isAdd) {
    this.setData({ [INVOICE_RULE_FIELD]: defaultData.value });
  }
};

setTimeout(async () => {
  try {
    await setupInvoiceRule();

    // The save workflow branches on this - it must always be populated.
    const pageStatus = this.isAdd
      ? 'Add'
      : this.isEdit
        ? 'Edit'
        : this.isView
          ? 'View'
          : '';
    this.setData({ page_status: pageStatus });

    if (this.isAdd) {
      this.setData({ reload_date: todayLocal() });
      return;
    }

    if (this.isEdit) {
      this.disabled(LOCKED_ON_EDIT, true);
      this.disabled(PAYMENT_FIELDS, false);
      return;
    }

    if (this.isView) {
      this.disabled([...LOCKED_ON_EDIT, ...PAYMENT_FIELDS], true);
      this.hide(['button_save']);
    }
  } catch (error) {
    console.error('Credit Reload: onMounted failed', error);
  }
}, 200);
