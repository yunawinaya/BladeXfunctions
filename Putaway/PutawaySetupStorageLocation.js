(async () => {
  this.setData({ default_loading_bay: "" });
  const data = arguments[0].fieldModel.item;

  const defaultLoadingBay = data.table_bin_location?.find(
    (bin) => bin.is_default_bin === 1,
  )?.bin_location_id;

  if (defaultLoadingBay) {
    this.setData({
      default_loading_bay: defaultLoadingBay,
    });
  }
})();
