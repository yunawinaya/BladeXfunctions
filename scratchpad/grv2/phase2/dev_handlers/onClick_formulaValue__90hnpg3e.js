(async () => {
  const formulaData = this.getValue(`dialog_formula.table_formula`);
  const formula = this.getValue(`dialog_formula.formula`);

  const filterFormulaData = formulaData.filter(
    (item) => item.formula_value && item.formula_value !== ""
  );
  if (formulaData.length !== filterFormulaData.length) {
    await this.$alert(
      "Please input all value.",
      "Insufficient Information Detected",
      {
        confirmButtonText: "Ok",
        type: "error",
      }
    );

    return;
  }

  let withoutBraces = formula.replace(/\{|\}/g, "");
  for (const item of formulaData) {
    withoutBraces = withoutBraces.replace(
      item.formula_variable,
      item.formula_value
    );
  }

  console.log("withoutBraces", withoutBraces);
  // Fix 1: Better power operator replacement that handles numbers after operators
  let formattedFormula = withoutBraces.replace(
    /(\d+(?:\.\d+)?)\^2/g,
    "Math.pow($1, 2)"
  );
  formattedFormula = formattedFormula.replace(
    /(\d+(?:\.\d+)?)\^3/g,
    "Math.pow($1, 3)"
  );

  // Fix 2: Also handle cases where the power operator follows a closing parenthesis
  formattedFormula = formattedFormula.replace(/(\))\^2/g, "$1**2");
  formattedFormula = formattedFormula.replace(/(\))\^3/g, "$1**3");

  console.log("formattedFormula", formattedFormula);
  const result = new Function("return " + formattedFormula)();

  console.log("result", result);

  this.setData({ [`dialog_formula.formula_result`]: result });
})();
