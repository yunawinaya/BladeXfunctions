(async () => {
  await this.openDialog("dialog_formula");

  const rowData = arguments[0].row;

  console.log("rowData", rowData);

  this.setData({
    [`dialog_formula.item_id`]: rowData.item_id,
    [`dialog_formula.item_name`]: rowData.item_id,
    [`dialog_formula.formula`]: rowData.formula,
    [`dialog_formula.based_uom`]: rowData.base_ordered_qty_uom,
  });

  const formula = rowData.formula;

  const withoutParens = formula.replace(/\(|\)/g, "");
  const operatorPattern = /(\+|-|\*|\/|\^2|\^3)/;
  let variableList = [];

  const elements = withoutParens
    .split(operatorPattern)
    .filter((item) => item.trim() !== "");

  for (const [index, item] of elements.entries()) {
    elements[index] = item.replace(/\{|\}/g, "");
  }

  console.log("elements", elements);

  for (const item of elements) {
    if (!operatorPattern.test(item) && !(/^-?\d*\.?\d+$/.test(item))) {
      variableList.push({
        formula_variable: item,
        value: 0,
      });
    }
  }

  this.setData({ [`dialog_formula.table_formula`]: variableList });
})();
