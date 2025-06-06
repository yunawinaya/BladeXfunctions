(async () => {
  const fake_purchase_order_id = arguments[0]?.fieldModel?.value;

  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }
  if (fake_purchase_order_id) {
    await this.setData({
      purchase_order_id: [fake_purchase_order_id],
      supplier_name: arguments[0]?.fieldModel?.item?.po_supplier_id,
      plant_id: arguments[0]?.fieldModel?.item?.po_plant,
      organization_id: organizationId,
    });

    await this.display("purchase_order_id");
    await this.hide("fake_purchase_order_id");
  }
})();
