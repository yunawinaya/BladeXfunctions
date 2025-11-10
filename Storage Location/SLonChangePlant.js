(async () => {
  const plantId = this.getValue("plant_id");

  if (plantId) {
    this.disabled(["location_type"], false);
    this.setData({ location_type: "" });
  }
})();
