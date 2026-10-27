// IA_SAVE v14 - a split receipt: one Batch row per batch (ADD_INVENTORY's columns, the IA number, the batch's base qty); none for a
// non-batch item
const f = [{{node:code_node_OSfinal.data}}][0] || {};
const p = [{{node:code_persisted.data}}][0] || {};
const a = [{{node:code_fillback.data.allData}}][0] || {};
const batch = f.kind === "SYSTEM" || f.kind === "MANUAL";
return { needBatch: batch ? "YES" : "NO", batchRows: batch ? osBatchRows(f.groups || [], a, p.stock_movement_no) : [], tenantId: /^[0-9]{1,20}$/.test(osS([{{system:tenantId}}][0])) ? osS([{{system:tenantId}}][0]) : "0" };
