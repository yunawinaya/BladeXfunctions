const t0 = Date.now();
const res = submitGate([{{node:code_node_SSguard.data}}][0], [{{node:code_node_SSentry.data}}][0], [{{node:code_node_SSkeys.data}}][0], [{{workflowparams:form}}][0],
  { items: [{{node:sql_node_SSitems.data}}][0], cost: [{{node:sql_node_SScost.data}}][0], stored: [{{node:sql_node_SSstored.data}}][0],
    scLines: [{{node:sql_node_SSscLines.data}}][0],
    rv: { items: [{{node:sql_node_SSrvItems.data}}][0], balances: [{{node:sql_node_SSrvBalances.data}}][0], batch_balances: [{{node:sql_node_SSrvBatchBalances.data}}][0],
      bins: [{{node:sql_node_SSrvBins.data}}][0], uoms: [{{node:sql_node_SSrvUoms.data}}][0], batches: [{{node:sql_node_SSrvBatches.data}}][0],
      costs: [{{node:sql_node_SSrvCosts.data}}][0], prefix: [{{node:sql_node_SSrvPrefix.data}}][0] } });
console.log("submit gate", JSON.stringify({ route: res.route, code: res.code, message: res.message, lines: res.lineCount, entries: res.entryCount, parts: res.partNames.length,
  ms: Date.now() - t0 }));
// the declared keys, spelled out (the platform keeps only these)
return {
  route: res.route, code: res.code, message: res.message, reason: res.reason, errorCode: res.errorCode, allData: res.allData, saHeader: res.saHeader,
  lineCount: res.lineCount, entryCount: res.entryCount, movementCount: res.movementCount, numberIssued: res.numberIssued,
  lineFingerprint: res.lineFingerprint, incomingFingerprint: res.incomingFingerprint, edited: res.edited, scFingerprint: res.scFingerprint,
  stockCountId: res.stockCountId, partNames: res.partNames, partChunks: res.partChunks, plantId: res.plantId, organizationId: res.organizationId
};
