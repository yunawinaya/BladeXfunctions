(async () => {
  const locationType = this.getValue("location_type");
  const plantId = this.getValue("plant_id");

  if (plantId) {
    this.disabled(
      [
        "is_default",
        "storage_location_name",
        "storage_location_code",
        "storage_description",
      ],
      false
    );
    const resStorageLocation = await db
      .collection("storage_location")
      .where({ plant_id: plantId, is_default: 1, location_type: locationType })
      .get();
    if (resStorageLocation.data.length === 0) {
      this.setData({ is_default: 1 });
    } else {
      this.setData({ is_default: 0 });
    }
  }
})();
