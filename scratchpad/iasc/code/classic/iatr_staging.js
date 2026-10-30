// IA_SAVE - IA transfer requests from a reserved IA (RESERVED_REQUEST_PLAN.md Task 8, D11): a completion after a receipt (code_node_IAguardStored
// decided so): every line a request can carry must be picked at the staging bin of the newest received request; serial-numbered,
// handling-unit and non-stock lines are picked as today (code/shared/iatr_guard2.js; the requests and the lines' items as sql_node_IAguard
// read them, the lines as sent; Line n = its position, the line_index code_fillback writes)
let iatrg2Doc = [{{workflowparams:allData}}][0];
if (typeof iatrg2Doc === "string") iatrg2Doc = iatrg2Parse(iatrg2Doc);
if (!iatrg2Doc || typeof iatrg2Doc !== "object" || Array.isArray(iatrg2Doc)) iatrg2Doc = {};
const iatrg2Rows = [{{node:sql_node_IAguard.data}}][0];
const iatrg2Row = (Array.isArray(iatrg2Rows) ? iatrg2Rows : [iatrg2Rows]).filter((r) => r && typeof r === "object")[0] || {};
const iatrg2Got = iatrg2Read(iatrg2Row.iatr);
const iatrg2Res = !iatrg2Got.bad ? iatrg2Staging(iatrg2Doc.stock_movement, iatrg2Got, null) : { ok: false, code: "IA_TR_UNREADABLE", message: IATRG2_TEXT.unreadable };
console.log("ia transfer request staging", JSON.stringify({ requests: iatrg2Got.reqs.length, ok: iatrg2Res.ok }));
return { route: iatrg2Res.ok ? "GO" : "STOP", message: iatrg2Res.message };
