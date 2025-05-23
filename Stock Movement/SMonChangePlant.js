(async () => {
  const plant = arguments[0]?.value;
  const stock_movement = this.getValue("stock_movement");

  db.collection("blade_dept")
    .where({ id: plant })
    .get()
    .then((resPlant) => {
      this.setData({ organization_id: resPlant.data[0].parent_id });
    });

  // First, set the bin location for items
  if (plant && stock_movement && stock_movement.length > 0) {
    const resBinLocation = await db
      .collection("bin_location")
      .where({
        plant_id: plant,
        is_default: true,
      })
      .get();

    let binLocation;

    if (resBinLocation.data && resBinLocation.data.length > 0) {
      binLocation = resBinLocation.data[0].id;
    } else {
      console.warn("No default bin location found for plant:", plant);
    }

    if (stock_movement && stock_movement.length > 0) {
      for (let i = 0; i < stock_movement.length; i++) {
        this.setData({
          [`stock_movement.${i}.location_id`]: binLocation,
        });
        this.setData({
          [`stock_movement.${i}.category`]: "Unrestricted",
        });
      }
    }
  }
})();
