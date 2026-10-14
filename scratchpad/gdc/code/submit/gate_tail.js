const guard = [{{node:code_node_GSguard.data}}][0];
const entry = [{{node:code_node_GSentry.data}}][0];
const S = {
  organizationId: entry.organizationId,
  hdr: [{{node:sql_node_GShdr.data}}][0], lines: [{{node:sql_node_GSlines.data}}][0], setup: [{{node:sql_node_GSsetup.data}}][0],
  link: [{{node:sql_node_GSlink.data}}][0], items: [{{node:sql_node_GSitems.data}}][0], sohl: [{{node:sql_node_GSsohl.data}}][0],
};
const t0 = Date.now();
const res = submitGate(guard, entry, S, guard.source === "FORM" ? [{{workflowparams:form}}][0] : null);
console.log("submit gate", JSON.stringify({ route: res.route, code: res.code, message: res.message, needCL: res.needCL, overrides: Object.keys(res.overrides).length, ms: Date.now() - t0 }));
return res;
