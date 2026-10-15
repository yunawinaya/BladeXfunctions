(async () => {
  const fakeItemId = arguments[0]?.value;

  if(!fakeItemId || fakeItemId === '') return;

  const plantId = this.getValue('plant_id');
  const organizationId = this.getValue('organization_id');

  const resReferencePO = await db
    .collection('purchase_order')
    .field('po_supplier_id')
    .where({ id: arguments[0].fieldModel.item.purchase_order_id.id })
    .get();

  if(!resReferencePO || resReferencePO.data.length === 0) return;

  const supplierName = resReferencePO.data[0].po_supplier_id;

  // const resPOOptions = await db
  //   .collection('purchase_order_2ukyuanr_sub')
  //   .collection('purchase_order')
  //   .field("purchase_order_id.purchase_order_no")
  //   .get();

  this.setData({
    item_id: [fakeItemId],
    supplier_name: supplierName || ''
  });

  await this.display(["item_id", "purchase_order_number"]);
  this.hide("fake_item_id");

  // console.log('resPOOptions',resPOOptions.data)

  // this.setOptionData('item_id', resPOOptions.data)
})();

