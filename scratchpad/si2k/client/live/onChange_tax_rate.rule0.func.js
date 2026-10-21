(async () => {
  if (arguments[0].value) {
    this.disabled(
      ["table_si." + arguments[0].rowIndex + ".tax_percent"],
      false
    );

    if (arguments[0].fieldModel) {
      this.setData({["table_si." + arguments[0].rowIndex + ".tax_percent"]: ''})
    }
  } else {
    this.disabled(
      ["table_si." + arguments[0].rowIndex + ".tax_percent"],
      true
    );

    this.setData({["table_si." + arguments[0].rowIndex + ".tax_percent"]: ''})
  }

  this.refreshFieldOptionData([`table_si.${arguments[0].rowIndex}.tax_percent`]);
})();