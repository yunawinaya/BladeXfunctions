// IA_SAVE v14 - the completion's final output split (osFinal): a System Settings split's groups take their generated numbers (all
// present, all different); the rows the header write stores. STOP = 400 before the claim and any write
const res = osFinal([{{node:code_node_OScheck.data}}][0], [{{node:get_OSbatchesFinal.data}}][0]);
console.log("ia output split final", JSON.stringify({ route: res.route, split: res.split, batches: res.groups.map((g) => g.batch_no) }));
return { route: res.route, message: res.message, split: res.split, kind: res.kind, output_split: res.output_split, groups: res.groups };
