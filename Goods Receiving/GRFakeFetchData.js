(async () => {
  const fake_purchase_order_id = arguments[0]?.fieldModel?.value;

  if (fake_purchase_order_id) {
    await this.setData({
      purchase_order_id: [fake_purchase_order_id],
      supplier_name: arguments[0]?.fieldModel?.item?.po_supplier_id,
    });

    await this.display("purchase_order_id");
    await this.hide("fake_purchase_order_id");
  }
})();
