(async () => {
  try {
    const default_uom_id = [];

    const based_uom = this.getValue("based_uom");
    const table_uom_conversion = this.getValue("table_uom_conversion");

    console.log("Based UOM:", based_uom);
    console.log("UOM Conversion Table:", table_uom_conversion);

    if (based_uom) {
      default_uom_id.push(based_uom);
    }

    if (table_uom_conversion && Array.isArray(table_uom_conversion)) {
      for (const item of table_uom_conversion) {
        if (item && item.alt_uom_id) {
          default_uom_id.push(item.alt_uom_id);
        }
      }
    } else {
      console.warn("table_uom_conversion is not an array or is undefined");
    }

    const uniqueUomIds = [...new Set(default_uom_id)];
    console.log("Unique UOM IDs to fetch:", uniqueUomIds);

    if (uniqueUomIds.length === 0) {
      console.warn("No UOM IDs found to fetch");
      await this.setOptionData(["purchase_default_uom"], []);
      await this.setOptionData(["sales_default_uom"], []);
      return;
    }

    const uomPromises = uniqueUomIds.map((uom_id) =>
      db
        .collection("unit_of_measurement")
        .where({ id: uom_id })
        .get()
        .then((result) => {
          if (result && result.data && result.data.length > 0) {
            return result.data[0];
          }
          console.warn(`UOM with ID ${uom_id} not found`);
          return null;
        })
        .catch((error) => {
          console.error(`Error fetching UOM with ID ${uom_id}:`, error);
          return null;
        })
    );

    const uomResults = await Promise.all(uomPromises);

    const validUomData = uomResults.filter(Boolean);

    console.log("Fetched UOM data:", validUomData);

    await this.setOptionData(["purchase_default_uom"], validUomData);
    await this.setOptionData(["sales_default_uom"], validUomData);

    console.log("Successfully set UOM options");
  } catch (error) {
    console.error("Error in UOM processing:", error);
    await this.setOptionData(["purchase_default_uom"], []);
    await this.setOptionData(["sales_default_uom"], []);
  }
})();
