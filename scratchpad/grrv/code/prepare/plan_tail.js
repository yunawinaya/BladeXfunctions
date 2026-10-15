const rvPlanRes = rvPlan([{{node:code_node_VPentry.data}}][0], [{{node:code_node_VPprep.data}}][0], {
  putaway: [{{node:sql_node_VPputaway.data}}][0], qi: [{{node:sql_node_VPqi.data}}][0], transit: [{{node:sql_node_VPtransit.data}}][0],
  batches: [{{node:sql_node_VPbatches.data}}][0], later: [{{node:sql_node_VPlater.data}}][0], fifo: [{{node:sql_node_VPfifo.data}}][0],
  wa: [{{node:sql_node_VPwa.data}}][0], costcounts: [{{node:sql_node_VPcostcounts.data}}][0], pi: [{{node:sql_node_VPpi.data}}][0],
  bbal: [{{node:sql_node_VPbbal.data}}][0], ibal: [{{node:sql_node_VPibal.data}}][0], hu: [{{node:sql_node_VPhu.data}}][0], po: [{{node:sql_node_VPpo.data}}][0],
  oo: [{{node:sql_node_VPoo.data}}][0], items: [{{node:sql_node_VPitems.data}}][0],
});
console.log("prepare plan", JSON.stringify({ route: rvPlanRes.route, code: rvPlanRes.code, message: rvPlanRes.message.slice(0, 300), lines: rvPlanRes.lineCount,
  movements: rvPlanRes.movementCount, parts: rvPlanRes.partRows.length, unlock: rvPlanRes.unlockOk }));
return rvPlanRes;
