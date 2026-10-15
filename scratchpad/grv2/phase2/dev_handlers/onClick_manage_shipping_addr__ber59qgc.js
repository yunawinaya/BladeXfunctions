
const data = this.getValues();

this.toView({
  target: "1905102178127777793",
  targetType: "Page",
  mode: "dialog",
  type: "add",
  position: "right",
  title: "Manage Shipping Address",
  params: {
    address_purpose: "Shipping",
    address_line1: data.shipping_address_line_1,
    address_line2: data.shipping_address_line_2,
    address_line3: data.shipping_address_line_3,
    address_line4: data.shipping_address_line_4,
    city: data.shipping_address_city,
    postal_code: data.shipping_postal_code,
    state: data.shipping_address_state,
    country: data.shipping_address_country,
    moduleName: "gr",
    customerId: "None",
    address_name: data.shipping_address_name,
    address_phone: data.shipping_address_phone,
    address_attention: data.shipping_attention,
    supplierId: this.getValue("supplier_name"),
    acc_integration_type: data.acc_integration_type,
    address_fax: data.shipping_address_fax
  },
});
