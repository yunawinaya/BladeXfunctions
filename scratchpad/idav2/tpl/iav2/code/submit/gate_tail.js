const t0 = Date.now();
const res = submitGate([{{node:code_node_ISguard.data}}][0], [{{node:code_node_ISentry.data}}][0], [{{node:code_node_ISkeys.data}}][0], [{{workflowparams:form}}][0],
  { items: [{{node:sql_node_ISitems.data}}][0], cost: [{{node:sql_node_IScost.data}}][0], wa: [{{node:sql_node_ISwa.data}}][0], dup: [{{node:sql_node_ISdup.data}}][0] });
console.log("submit gate", JSON.stringify({ route: res.route, code: res.code, message: res.message, lines: res.lineCount, picks: res.pickCount, stock: res.stockPickCount,
  batch: res.needBatch, ms: Date.now() - t0 }));
// the declared keys, spelled out (the platform keeps only these)
return {
  route: res.route, code: res.code, message: res.message, reason: res.reason, errorCode: res.errorCode, allData: res.allData, lineCount: res.lineCount,
  pickCount: res.pickCount, stockPickCount: res.stockPickCount, nonStockLines: res.nonStockLines, movementCount: res.movementCount, plantId: res.plantId,
  organizationId: res.organizationId, stockMovementNo: res.stockMovementNo, needBatch: res.needBatch, batchItemId: res.batchItemId, batchDocDate: res.batchDocDate,
  batchMfgDate: res.batchMfgDate, batchExpDate: res.batchExpDate, batchOrg: res.batchOrg
};
