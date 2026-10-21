let iarvPlanRes;
try {
  iarvPlanRes = iarvPlanNode([{{node:code_node_IVPentry.data}}][0], [{{node:code_node_IVPprep.data}}][0], {
    hdr: [{{node:sql_node_IVPhdr.data}}][0], moves: [{{node:sql_node_IVPmoves.data}}][0], batch: [{{node:sql_node_IVPbatch.data}}][0], fifo: [{{node:sql_node_IVPfifo.data}}][0],
    wa: [{{node:sql_node_IVPwa.data}}][0], costcounts: [{{node:sql_node_IVPcostcounts.data}}][0], itemBal: [{{node:sql_node_IVPitembal.data}}][0],
    batchBal: [{{node:sql_node_IVPbatchbal.data}}][0], items: [{{node:sql_node_IVPitems.data}}][0], bins: [{{node:sql_node_IVPbins.data}}][0],
    res: [{{node:sql_node_IVPres.data}}][0],
  });
} catch (e) {
  // the prep node passed the lock check: an invariant that broke afterwards still puts the Item Assembly back to Completed
  iarvPlanRes = { route: "FAIL", code: "IA_RV_PLAN_BROKEN", message: "The revert could not be prepared: " + String((e && e.message) || e).slice(0, 200), payload: "", partRows: [], lineCount: 0,
    movementCount: 0, unlockOk: 1, details: "", needPlan: "NO", operationKey: "", organizationId: "", movements: [], labels: {}, keys: [] };
}
console.log("prepare plan", JSON.stringify({ route: iarvPlanRes.route, code: iarvPlanRes.code, message: String(iarvPlanRes.message).slice(0, 300), live: iarvPlanRes.lineCount,
  movements: iarvPlanRes.movementCount, parts: iarvPlanRes.partRows.length, unlock: iarvPlanRes.unlockOk }));
return { route: iarvPlanRes.route, code: iarvPlanRes.code, message: iarvPlanRes.message, payload: iarvPlanRes.payload, partRows: iarvPlanRes.partRows, lineCount: iarvPlanRes.lineCount,
  movementCount: iarvPlanRes.movementCount, unlockOk: iarvPlanRes.unlockOk, details: iarvPlanRes.details, needPlan: iarvPlanRes.needPlan, operationKey: iarvPlanRes.operationKey,
  organizationId: iarvPlanRes.organizationId, movements: iarvPlanRes.movements, labels: iarvPlanRes.labels, keys: iarvPlanRes.keys };
