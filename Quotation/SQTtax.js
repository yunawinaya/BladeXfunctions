const taxRatePercent = await db
  .collection("tax_rate_percent")
  .where({ tax_code: arguments[0].value })
  .get();

(async () => {
  try {
    if (taxRatePercent.data.length > 0) {
      const taxRateOptions = [];
      for (let i = 0; i < taxRatePercent.data.length; i++) {
        taxRateOptions.push(taxRatePercent.data[i]);
      }

      console.log("taxRateOptions", taxRateOptions);
      await this.setOptionData(
        [`table_sqt.${arguments[0].rowIndex}.sqt_tax_rate_percent`],
        taxRateOptions
      );
      await this.disabled(
        [`table_sqt.${arguments[0].rowIndex}.sqt_tax_rate_percent`],
        false
      );
    }
  } catch (error) {
    console.error("Error in SQTtax:", error);
  }
})();
