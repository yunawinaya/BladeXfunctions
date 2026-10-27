// IA_SAVE v14 - output split (plan 10-27, shared/os_split.js osMerge): the rows this save writes - the payload's, or the stored ones
// when it leaves the key out (mobile), which it may then not move; STOP = 400 before any write. A completion checks them next
const a = [{{node:code_fillback.data.allData}}][0] || {};
const page = [{{workflowparams:pageStatus}}][0];
const src = osJ([{{node:sql_node_SCsource.data}}][0]);
const res = osMerge(a, src ? src.stored : null, { edit: page === "Edit" && /^[0-9]{1,20}$/.test(osS(a.id)), tenantId: [{{system:tenantId}}][0] });
console.log("ia output split", JSON.stringify({ route: res.route, split: res.split, rows: res.count }));
return { route: res.route, message: res.message, split: res.split, output_split: res.output_split, count: res.count, binIds: res.binIds, tenantId: res.tenantId };
