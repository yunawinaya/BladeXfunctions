const data = this.getValues();

this.toView({
  target: "1905102178127777793",
  targetType: "Page",
  mode: "dialog",
  type: "add",
  position: "right",
  title: "Manage Billing Address",
  params: {
    address_purpose: "Billing",
    address_line1: data.billing_address_line_1,
    address_line2: data.billing_address_line_2,
    address_line3: data.billing_address_line_3,
    address_line4: data.billing_address_line_4,
    city: data.billing_address_city,
    postal_code: data.billing_postal_code,
    state: data.billing_address_state,
    country: data.billing_address_country,
    moduleName: "gr",
    customerId: "None",
    address_name: data.billing_address_name,
    address_phone: data.billing_address_phone,
    address_attention: data.billing_attention,
    supplierId: this.getValue("supplier_name"),
    acc_integration_type: data.acc_integration_type,
    address_fax: data.billing_address_fax
  },
});
