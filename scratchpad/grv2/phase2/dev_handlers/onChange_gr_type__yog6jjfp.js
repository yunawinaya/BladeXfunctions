(async () => {
    const grType = arguments[0].value;
    const supplierId = this.getValue('supplier_name');
    const plantId = this.getValue('plant_id');

    this.setData({
        fake_purchase_order_id: '',
        purchase_order_id: '',
        fake_item_id: '',
        item_id: '',
        purchase_order_number: '',
      item_code: '',
        table_gr: [],
    })

    this.hide(["item_code", "purchase_order_number"]);
    if(grType === 'Document'){
        this.hide(['fake_item_id', 'item_id']);

        if(!plantId) {
            this.disabled('fake_purchase_order_id', true);
            return;
        }

        if(!supplierId) {
            this.display('fake_purchase_order_id');
            this.disabled('fake_purchase_order_id', false);
            this.hide('purchase_order_id');
        } else {
            this.display('purchase_order_id');
            this.hide('fake_purchase_order_id');
        }
    } else if (grType === 'Item') {
        this.hide(['fake_purchase_order_id', 'purchase_order_id']);

        if(!supplierId) {
            this.display('fake_item_id');
            this.hide('item_id');
        } else {
            this.display('item_id');
            this.hide('fake_item_id');
        }
    }
})();