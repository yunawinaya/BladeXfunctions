(async () => {
  const supplierId = arguments[0]?.value;
  const supplierChangeId = this.getValue("supplier_change_id");

  const supplierContactData = arguments[0]?.fieldModel?.item.contact_list[0];

  if (
    supplierId &&
    (!supplierChangeId || supplierChangeId !== supplierId) &&
    !Array.isArray(supplierId)
  ) {
    await this.setData({ supplier_change_id: supplierId });
    await this.setData({ purchase_order_id: undefined });
    await this.disabled(["purchase_order_id"], false);
    await this.setData({
      supplier_contact_person: supplierContactData.person_name,
      supplier_contact_number: supplierContactData.mobile_number,
      supplier_email: supplierContactData.person_email,
    });
  }
})();
