const taxRatePercent = await db
  .collection("tax_rate_percent")
  .where({ tax_code: arguments[0].value })
  .get();

(async () => {
  try {
    if (taxRatePercent.data.length > 0) {
      const taxRateOptions = [];
      for (let i = 0; i < taxRatePercent.data.length; i++) {
        taxRateOptions.push({
          value: taxRatePercent.data[i].tax_rate_percent,
          label: taxRatePercent.data[i].tax_rate_percent,
        });
      }

      console.log("taxRateOptions", taxRateOptions);
      await this.setOptionData(
        [`table_so.${arguments[0].rowIndex}.so_tax_percentage`],
        taxRateOptions
      );
      await this.disabled(
        [`table_so.${arguments[0].rowIndex}.so_tax_percentage`],
        false
      );
    }
  } catch (error) {
    console.error("Error in SOtax:", error);
  }
})();
