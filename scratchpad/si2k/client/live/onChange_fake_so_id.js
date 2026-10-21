(async () => {
  const fake_so_id = arguments[0]?.value;

  if (fake_so_id) {
    await this.setData({
      so_id: [fake_so_id],
      customer_id: arguments[0]?.fieldModel?.item?.customer_name.id,
    });

    await this.display("so_id");
    await this.hide("fake_so_id");
  }
})();
