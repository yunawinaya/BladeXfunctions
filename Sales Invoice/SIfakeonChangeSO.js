(async () => {
  const fake_so_id = arguments[0]?.fieldModel?.value;

  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }

  if (fake_so_id) {
    await this.setData({
      so_id: [fake_so_id],
      customer_id: arguments[0]?.fieldModel?.item?.customer_name,
      plant_id: arguments[0]?.fieldModel?.item?.plant_name,
      organization_id: organizationId,
    });

    await this.display("so_id");
    await this.hide("fake_so_id");
  }
})();
