(async () => {
  const value = arguments[0].value;

  let salesGroupData = [];

  const salesGroupFilter = new Filter("any")
    .eq("is_admin", 1)
    .eq("agent_id", value)
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

  if (salesGroupIds.length > 0 && value) {
    await this.setData({
      access_group: salesGroupIds,
    });
  }
})();
