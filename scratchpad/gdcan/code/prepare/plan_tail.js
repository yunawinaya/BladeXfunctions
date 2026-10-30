const entry = [{{node:code_node_XPentry.data}}][0];
const S = {
  organizationId: entry.organizationId,
  hdr: [{{node:sql_node_XPhdr.data}}][0], lines: [{{node:sql_node_XPlines.data}}][0], setup: [{{node:sql_node_XPsetup.data}}][0],
  link: [{{node:sql_node_XPlink.data}}][0], items: [{{node:sql_node_XPitems.data}}][0], sohl: [{{node:sql_node_XPsohl.data}}][0],
  soh: [{{node:sql_node_XPsoh.data}}][0], alloc: [{{node:sql_node_XPalloc.data}}][0], pend: [{{node:sql_node_XPpend.data}}][0],
  top: [{{node:sql_node_XPtop.data}}][0], topr: [{{node:sql_node_XPtopr.data}}][0], lock: [{{node:sql_node_XPlock.data}}][0],
  pick: [{{node:sql_node_XPpick.data}}][0], pack: [{{node:sql_node_XPpack.data}}][0], box: [{{node:sql_node_XPbox.data}}][0],
  cnos: [{{node:sql_node_XPcnos.data}}][0],
};
let res;
if (entry.route !== "GO") res = { route: "FAIL", code: entry.result_code, message: entry.result_message, operationKey: "", organizationId: entry.organizationId, movements: [], payload: "", partRows: [], lineCount: 0, movementCount: 0, gdId: entry.gdId, unlockOk: 0 };
else res = gxPlan(entry, S);
console.log("prepare plan", JSON.stringify({ route: res.route, code: res.code, message: res.message, lines: res.lineCount, movements: res.movementCount, parts: res.partRows.length, unlock: res.unlockOk }));
return res;
