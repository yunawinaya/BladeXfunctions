// Duplicate guard, step 2, before the stock check: did an earlier save with this key, or (within 15 minutes) this
// content, already reach the table? SAVED: REPLAY, a 200 with that transfer, so an app that lost the first reply
// carries on to its automatic In Progress. Still SAVING: WAIT (400 PT_SAVE_IN_PROGRESS). SAVING for 30+ minutes:
// STOP (400 PT_SAVE_INCOMPLETE). Nothing found: GO.
const pick = dupPool(dupRows([{{node:sql_node_PTdupFind.data}}][0]))[0];
if (!pick) return { route: "GO", code: "200", message: "", result_code: "", id: "", stock_movement_no: "", stock_movement_status: "", replayed: "0" };
return dupAnswer(pick);
