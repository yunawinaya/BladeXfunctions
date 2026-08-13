// Customer Statement list page > onChange for the five filter switches
// (date_range_switch, statement_date_switch, customer_switch, area_switch,
// project_switch). Clears the input beside a switch as soon as it is turned off.
//
// Wire this SAME function to all five onChange slots. It reconciles the whole
// panel instead of reacting to the one switch that fired, because the switch
// onChange payload carries `arguments[0].value` (the new value) but NOT the
// model that changed -- see `stock_control` in Item/ItemFullJSON.json. Doing it
// that way means one function instead of five, and it is idempotent, so being
// invoked from any of the five slots is safe.
//
// The disabled bindings on the inputs already grey them out when their switch is
// off; this clears the value behind them so what the user sees and what the
// query filters on agree. CSgenerateStatement.js repeats this check at Generate
// time as a safety net in case a slot is left unwired.
(async () => {
  // [ switch model, input model, the value that means "empty" for that input ]
  const FILTERS = [
    ["date_range_switch", "date_range", ""],
    ["statement_date_switch", "statement_date", ""],
    ["customer_switch", "customer_id", []],
    ["area_switch", "area_id", []],
    ["project_switch", "project_id", []],
  ];

  const isEmpty = (v) =>
    v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
  // Switches are `booleanValueMode: false`, so they carry 0/1 -- but tolerate
  // the boolean and string forms too rather than depending on which one arrives.
  const isOn = (v) => v === 1 || v === "1" || v === true;

  try {
    const updates = {};

    for (const [switchModel, inputModel, emptyValue] of FILTERS) {
      if (isOn(this.getValue(switchModel))) continue;
      if (isEmpty(this.getValue(inputModel))) continue;
      updates[inputModel] = emptyValue;
    }

    // Skip the write entirely when nothing is stale -- setData on every toggle
    // would re-render the whole filter panel for no reason.
    if (Object.keys(updates).length > 0) {
      await this.setData(updates);
    }
  } catch (error) {
    console.error("[CS filter switch] failed to clear disabled filters", error);
  }
})();
