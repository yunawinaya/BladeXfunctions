// IA_V2_SUBMIT v4 - Small Cycle in (scIn, code/shared/sc_check.js): the form record with the guard's id and page status (Clone = Add)
const g = [{{node:code_node_ISguard.data}}][0] || {};
const rec = Object.assign({}, scParseJ([{{workflowparams:form}}][0]) || {}, { id: g.iaId });
const res = scIn({ allData: rec, pageStatus: g.pageStatus, tenantId: g.tenantId });
console.log("small cycle in", JSON.stringify(res));
return res;
