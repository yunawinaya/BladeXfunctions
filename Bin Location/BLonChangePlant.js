(async () => {
  const plantId = this.getValue("plant_id");

  if (plantId) {
    this.disabled(["storage_location_id"], false);
  }
})();
