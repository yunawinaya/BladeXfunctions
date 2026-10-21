(async () => {
  const plant = arguments[0]?.value;

  console.log('plant', plant)
  this.hide('address_grid')

  this.setData({
    so_id: [],
    gd_id: [],
    customer_id: '',
    currency_code: '',
    so_no_display: '',
    si_billing_address: '',
    si_shipping_address: '',

    gd_no_display: '',
    sales_person_id: '',
    si_area_id: '',
    si_payment_term_id: '',
    exchange_rate: '',
    exchange_rate_currency: '',

    table_si: [],

    billing_address_line_1: '',
    billing_address_line_2: '',
    billing_address_line_3: '',
    billing_address_line_4: '',

    billing_address_city: '',
    billing_postal_code: '',
    billing_address_state: '',
    billing_address_country: '',

    billing_address_name: '',
    billing_address_phone: '',
    billing_attention: '',

    shipping_address_line_1: '',
    shipping_address_line_1: '',
    shipping_address_line_1: '',
    shipping_address_line_1: '',

    shipping_address_city: '',
    shipping_postal_code: '',
    shipping_address_state: '',
    shipping_address_country: '',

    shipping_address_name: '',
    shipping_address_phone: '',
    shipping_attention: '',
    reference_type: '',
  })

  if(plant){
      this.disabled([
        'invoice_souce', 'invoice_type',
        'sales_person_id', 'si_area_id', 'sales_invoice_date', 'si_payment_term_id',
        'si_description', 'remarks', 'si_ref_doc', 'table_si'
       ], false);

      // table_si is a tree so that an item bundle can hold its items, but a
      // bundle's items come from the bundle -- they are never added by hand.
      // Clearing the table above re-renders it with the add-child control back,
      // so it is taken away again here. Same call the PI form makes.
      this.getComponent('table_si')?.hideChildRecord();
  } else{
    this.disabled([
      'invoice_souce', 'invoice_type',
        'sales_person_id', 'si_area_id', 'sales_invoice_date', 'si_payment_term_id',
        'si_description', 'remarks', 'si_ref_doc', 'table_si'
       ], true);
  }


})();
