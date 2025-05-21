(async () => {
  const fake_so_id = arguments[0]?.value;

  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }

  if (fake_so_id && !Array.isArray(fake_so_id)) {
    const resSO = await db
      .collection("sales_order")
      .where({ id: fake_so_id })
      .get();

    const soData = resSO.data[0];

    console.log("soData", soData);

    await this.setData({
      sr_return_so_id: [fake_so_id],
      customer_id: soData.customer_name,
      plant_id: soData.plant_name,
      organization_id: organizationId,
    });

    await this.display("sr_return_so_id");
    await this.hide("fake_sr_return_so_id");
  }
})();
