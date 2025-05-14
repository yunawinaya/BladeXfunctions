db.collection("tax_rate_percent")
  .where({ tax_code: arguments[0].value })
  .get()
  .then((re) => {
    if (re.data.length > 0) {
      this.setData({
        [`table_po.${arguments[0].rowIndex}.tax_rate_percent`]: undefined,
      });
      this.setOptionData(
        "table_po." + arguments[0].rowIndex + ".tax_rate_percent",
        re.data
      );

      this.disabled(
        ["table_po." + arguments[0].rowIndex + ".tax_rate_percent"],
        false
      );
    }
  });

console.log("arguments[0]", arguments[0]);
