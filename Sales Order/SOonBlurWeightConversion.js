(async () => {
  const rowIndex = arguments[0].rowIndex;
  const weightConversion = arguments[0].value;

  // User manually edited the per-unit weight (weight_conversion). Recompute the
  // line net weight from the current so_quantity: net_weight = so_quantity *
  // weight_conversion.
  if (
    weightConversion !== undefined &&
    weightConversion !== null &&
    weightConversion !== ""
  ) {
    const soQuantity = this.getValue(`table_so.${rowIndex}.so_quantity`) || 0;
    const netWeight =
      Math.round(Number(soQuantity) * Number(weightConversion) * 1000) / 1000;
    this.setData({ [`table_so.${rowIndex}.net_weight`]: netWeight });
  }
})();
