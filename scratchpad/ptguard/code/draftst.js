// Draft on a stored transfer: only a Draft may be saved as Draft. Saving an Issued / In Progress transfer back to
// Draft leaves its stock In Transit with nothing to reverse it, and issuing it again deducts the source twice.
const row = dupRows([{{node:sql_node_PTdupDraftSt.data}}][0])[0];
const st = s(row && row.stock_movement_status);
if (!row || st === "" || st === "Draft") return { route: "GO", code: "200", message: "", result_code: "", id: "", stock_movement_no: "", stock_movement_status: st };
const no = s(row.stock_movement_no) || "This transfer";
return { route: "REFUSE", code: "400", result_code: "PT_DRAFT_NOT_ALLOWED", message: no + " is " + st + " and can't be saved back to Draft.",
  id: s(row.id), stock_movement_no: s(row.stock_movement_no), stock_movement_status: st };
