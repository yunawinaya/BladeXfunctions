const deliveryAddress = this.getValue('po_delivery_address');

if(deliveryAddress === 'Supplier') {
    this.display('po_receiving_supplier');
    this.hide(['po_plant', 'address_grid']);
    this.setData({'po_plant': ''});
} else {
    this.hide(['po_receiving_supplier','address_grid']);
    this.display('po_plant');
    this.setData({'po_receiving_supplier': ''});
}

this.setData({
    'po_billing_name': '',
    'po_billing_cp': '',
    'po_shipping_address': '',
    'po_billing_address': '',
    'billing_address_line_1': '',
    'billing_address_line_2': '',
    'billing_address_line_3': '',
    'billing_address_line_4': '',
    'billing_address_city': '',
    'billing_address_state': '',
    'billing_postal_code': '',
    'billing_address_country': '',
    'shipping_address_line_1': '',
    'shipping_address_line_2': '',
    'shipping_address_line_3': '',
    'shipping_address_line_4': '',
    'shipping_address_city': '',
    'shipping_address_state': '',
    'shipping_postal_code': '',
    'shipping_address_country': '',
});