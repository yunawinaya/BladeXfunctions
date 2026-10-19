// The GD lines this call puts on a live Picking (an Add, or a Draft saved as Created / Completed) and how much of each:
// sql_node_Cover reads what other live Pickings already hold of them. Confirms of a live Picking (mobile, the form) are
// not checked and read nothing. Digits only: the ids are interpolated into sql_node_Cover.
const items = {{workflowparams:arrayData}};
const saveAs = {{workflowparams:saveAs}};
const pageStatus = {{workflowparams:pageStatus}};
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const digits = (v) => (/^[0-9]{1,20}$/.test(String(v === undefined || v === null ? "" : v)) ? String(v) : "");
const mine = {};
const gds = new Set();
const own = new Set();
if (saveAs !== "Draft" && saveAs !== "Cancelled") {
  for (const p of Array.isArray(items) ? items : []) {
    if (!p || (pageStatus !== "Add" && p.to_status !== "Draft")) continue;
    if (digits(p.id)) own.add(digits(p.id));
    for (const id of Array.isArray(p.gd_no) ? p.gd_no : []) if (digits(id)) gds.add(digits(id));
    const rows = [];
    for (const r of Array.isArray(p.table_picking_items) ? p.table_picking_items : []) {
      if (!r) continue;
      rows.push(r);
      for (const c of Array.isArray(r.children) ? r.children : []) if (c) rows.push(c);
    }
    for (const r of rows) {
      const line = digits(r.gd_line_id);
      if (!line || r.row_type === "header" || r.line_status === "Cancelled") continue;
      if (digits(r.gd_id)) gds.add(digits(r.gd_id));
      mine[line] = q8((mine[line] || 0) + q8(r.qty_to_pick));
    }
  }
}
for (const line of Object.keys(mine)) if (!(mine[line] > 0)) delete mine[line];
const lines = Object.keys(mine);
return {
  check: lines.length > 0 && gds.size > 0 ? 1 : 0,
  lineIdCsv: lines.length ? lines.join(",") : "0",
  gdIdCsv: gds.size ? [...gds].join(",") : "0",
  ownIdCsv: own.size ? [...own].join(",") : "0",
  mine,
};
