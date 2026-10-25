// BALANCE_UOM_CONVERSION - Guard: the request inputs reach the SQL only as digit ids or fixed words, never as caller text
// (security review 2026-10-24). Every value the Item Balance grid sends maps to itself; anything else matches no rows, as before.
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const id = (v) => (/^[0-9]{1,20}$/.test(s(v)) ? s(v) : s(v) === "" ? "" : "0");
const dept = [{{workflowparams:selected_dept_id}}][0];
return {
  material_id: id([{{workflowparams:material_id}}][0]),
  material_uom: id([{{workflowparams:material_uom}}][0]),
  balance_type: s([{{workflowparams:balance_type}}][0]) === "item_batch_balance" ? "item_batch_balance" : "item_balance",
  // a missing plant matched nothing before (the placeholder became the text null); blank keeps the organization scope
  selected_dept_id: dept === undefined || dept === null ? "0" : id(dept),
};
