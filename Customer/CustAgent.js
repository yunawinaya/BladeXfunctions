(async () => {
  const customer_agent_id = arguments[0].value;

  let salesGroupData = [];

  const salesGroupFilter = new Filter("any")
    .eq("is_admin", 1)
    .eq("agent_id", customer_agent_id)
    .build();

  await db
    .collection("sales_group")
    .filter(salesGroupFilter)
    .get()
    .then((res) => {
      salesGroupData = res.data;
      console.log("salesGroupData", salesGroupData);
    });

  const salesGroupIds = salesGroupData.map((item) => item.id);

  await this.setData({
    access_group: salesGroupIds,
  });
})();
