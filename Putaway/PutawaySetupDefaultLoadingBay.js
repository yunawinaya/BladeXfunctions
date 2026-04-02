(async () => {
  const plantID = this.getValue("plant_id");
  const value = arguments[0].value;
  const resStorageLocation = await db
    .collection("storage_location")
    .where({
      plant_id: plantID,
      storage_status: 1,
      location_type: "Loading Bay",
      is_default: 1,
    })
    .get();
  if (
    !resStorageLocation ||
    resStorageLocation.data.length === 0 ||
    value === 0
  ) {
    this.setData({
      default_loading_bay: "",
    });
    return;
  }

  console.log("resStorageLocation", resStorageLocation);

  const defaultLoadingBay = resStorageLocation.data[0].table_bin_location.find(
    (bin) => bin.is_default_bin === 1,
  ).bin_location_id;

  this.setData({
    default_loading_bay: defaultLoadingBay,
  });
})();
