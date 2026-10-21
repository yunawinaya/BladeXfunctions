const t0 = Date.now();
const res = submitGate([{{node:code_node_DSguard.data}}][0], [{{node:code_node_DSentry.data}}][0], [{{node:code_node_DSkeys.data}}][0], [{{workflowparams:form}}][0],
  { items: [{{node:sql_node_DSitems.data}}][0], cost: [{{node:sql_node_DScost.data}}][0], wa: [{{node:sql_node_DSwa.data}}][0], dup: [{{node:sql_node_DSdup.data}}][0],
    bnc: [{{node:sql_node_DSbnc.data}}][0], batches: [{{node:sql_node_DSbatches.data}}][0] });
console.log("submit gate", JSON.stringify({ route: res.route, code: res.code, message: res.message, lines: res.lineCount, picks: res.pickCount, moves: res.moveCount,
  stock: res.stockLines, auto: res.autoLines, ms: Date.now() - t0 }));
// the declared keys, spelled out (the platform keeps only these)
return {
  route: res.route, code: res.code, message: res.message, reason: res.reason, errorCode: res.errorCode, allData: res.allData, lineCount: res.lineCount,
  pickCount: res.pickCount, moveCount: res.moveCount, stockLines: res.stockLines, nonStockLines: res.nonStockLines, autoLines: res.autoLines, plantId: res.plantId,
  organizationId: res.organizationId, stockMovementNo: res.stockMovementNo
};
