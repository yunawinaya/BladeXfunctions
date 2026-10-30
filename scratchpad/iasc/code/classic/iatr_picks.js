// IA_SAVE - IA transfer request (ENH-20261027-001, spec IA-LT-06): a Created / Completed save of an IA whose supply request was received
// (code_node_IAguardStored decided so): every pick of a line the request supplied must be at its destination bin (code/shared/iatr_guard.js;
// the request as sql_node_IAguard read it, the lines as sent; Line n = its position, the line_index code_fillback writes)
let iatrgDoc = [{{workflowparams:allData}}][0];
if (typeof iatrgDoc === "string") iatrgDoc = iatrgParse(iatrgDoc);
if (!iatrgDoc || typeof iatrgDoc !== "object" || Array.isArray(iatrgDoc)) iatrgDoc = {};
const iatrgRows = [{{node:sql_node_IAguard.data}}][0];
const iatrgRow = (Array.isArray(iatrgRows) ? iatrgRows : [iatrgRows]).filter((r) => r && typeof r === "object")[0] || {};
const iatrgReq = iatrgRequest(iatrgRow.iatr);
const iatrgRes = iatrgReq && !iatrgReq.bad ? iatrgPicks(iatrgDoc.stock_movement, iatrgReq) : { ok: false, code: "IA_TR_UNREADABLE", message: IATRG_TEXT.unreadable };
console.log("ia transfer request picks", JSON.stringify({ request: iatrgReq ? iatrgReq.no || iatrgReq.id || "" : "", ok: iatrgRes.ok }));
return { route: iatrgRes.ok ? "GO" : "STOP", message: iatrgRes.message };
