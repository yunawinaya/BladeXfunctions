const priceTagId = this.getValue('price_tag_id');
const supplierId = this.getValue('po_supplier_id');

this.toView({
  target: '1983374741340389378', 
  targetType: 'Page',
  mode: 'dialog',
  type: 'edit', 
  params: { 'price_tag_id': priceTagId, 'supplier_id': supplierId },
  title: 'Batch Add' 
});