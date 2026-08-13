// Customer Statement list page > "Generate" button (`generate_button`) onClick.
//
// This does NOT call runWorkflow. The table `custom_4457str7` is bound to the
// CS_GENERATE_FILTER workflow and owns the call itself, reading each filter
// through its `url_params` `{{value:...}}` bindings. So the button's whole job
// is: validate the inputs, drop values whose switch is off, and re-trigger the
// query with refreshChange() -- the same shape as Balance Table/BalanceOnChangeUOM.js.
(async () => {
  const TABLE = "custom_4457str7";

  // [ switch model, input model, label, the value that means "empty" ]
  const FILTERS = [
    ["date_range_switch", "date_range", "Date", ""],
    ["statement_date_switch", "statement_date", "Statement Date", ""],
    ["customer_switch", "customer_id", "Customer", []],
    ["area_switch", "area_id", "Area", []],
    ["project_switch", "project_id", "Project", []],
  ];

  const isEmpty = (v) =>
    v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
  // Switches are `booleanValueMode: false`, so they carry 0/1 -- but tolerate
  // the boolean and string forms too rather than depending on which one arrives.
  const isOn = (v) => v === 1 || v === "1" || v === true;

  const missing = [];
  const stale = {};

  for (const [switchModel, inputModel, label, emptyValue] of FILTERS) {
    const hasValue = !isEmpty(this.getValue(inputModel));
    if (isOn(this.getValue(switchModel))) {
      if (!hasValue) missing.push(label);
    } else if (hasValue) {
      // Toggling a switch off disables its input but leaves the value behind.
      // Clear it so what the user sees and what the query filters on agree.
      // (The SQL gates on the switch as well, so this is belt and braces.)
      stale[inputModel] = emptyValue;
    }
  }

  if (missing.length > 0) {
    this.$message.error(
      `Please select a value for: ${missing.join(", ")} — or switch the filter off.`
    );
    return;
  }

  try {
    this.showLoading("Generating statement...");

    if (Object.keys(stale).length > 0) {
      await this.setData(stale);
    }

    // Let the models commit before the grid re-reads its {{value:...}} params;
    // without this the refresh can race and re-query with the PREVIOUS filters.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const grid = await this.getComponent(TABLE);
    if (!grid) {
      console.warn("[CS generate] table component not found:", TABLE);
      this.$message.error("Statement table not found on this page.");
      return;
    }

    // Awaited so the loading overlay covers the grid's own fetch, not just the
    // call. Harmless if refreshChange() returns undefined rather than a promise.
    await grid.refreshChange();
  } catch (error) {
    console.error("[CS generate] refresh failed", error);
    this.$message.error("Failed to generate the statement. Please try again.");
  } finally {
    this.hideLoading();
  }
})();
