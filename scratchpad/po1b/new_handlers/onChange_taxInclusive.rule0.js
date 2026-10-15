const value = arguments[0].value;

// AutoCount: one Tax Inclusive for every line, written only if a line differs.
if (this.getValue("acc_integration_type") === "AutoCount Accounting V2") {
  const rows = this.getValue("table_po") || [];

  if (rows.some((row) => !Object.is(row.tax_inclusive, value))) {
    this.setData({ "table_po.tax_inclusive": value });
  }
}
