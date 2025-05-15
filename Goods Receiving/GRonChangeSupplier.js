(async () => {
  const supplierId = arguments[0]?.value;
  const supplierChangeId = this.getValue("supplier_change_id");

  if (
    supplierId &&
    (!supplierChangeId || supplierChangeId !== supplierId) &&
    !Array.isArray(supplierId)
  ) {
    await this.setData({ supplier_change_id: supplierId });
    await this.setData({ purchase_order_id: undefined });
    await this.disabled(["purchase_order_id"], false);
  }
})();
