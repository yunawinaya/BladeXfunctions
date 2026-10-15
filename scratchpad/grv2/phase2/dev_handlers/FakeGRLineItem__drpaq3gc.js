console.log('arguments', arguments[0])
const fake_purchase_order_id = arguments[0]?.value;

  if (fake_purchase_order_id !== '') {
    this.setData({
      purchase_order_id: [fake_purchase_order_id],
      supplier_name: arguments[0]?.fieldModel?.item?.po_supplier_id.id,
    });

    this.display("purchase_order_id");
    this.hide("fake_purchase_order_id");
  }

