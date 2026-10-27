// IA_V2_SUBMIT v6 - the completion's final output split (osFinal, as IA_SAVE v14's code_node_OSfinal): a System split's groups take their
// generated numbers (all present, all different); the rows the IA writes store ([] without a split); row 1's number = the header's batch_no.
// STOP = 400 before any write
const res = osFinal({ split: [{{node:code_node_ISgate.data.osSplit}}][0], kind: [{{node:code_node_ISgate.data.osKind}}][0], output_split: [{{node:code_node_ISgate.data.osRows}}][0],
  groups: [{{node:code_node_ISgate.data.osGroups}}][0], gen: [{{node:code_node_ISgate.data.osGen}}][0] }, [{{node:get_ISosBatchesFinal.data}}][0]);
const rows = res.output_split || [];
console.log("submit output split", JSON.stringify({ route: res.route, split: res.split, rows: rows.length, batches: (res.groups || []).map((g) => g.batch_no) }));
return { route: res.route, message: res.message, split: res.split, kind: res.kind, output_split: rows, groups: res.groups || [],
  batchNo: res.split === "YES" && res.kind === "SYSTEM" && rows.length ? osS(rows[0].os_batch_no) : "" };
