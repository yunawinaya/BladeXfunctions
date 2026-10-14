// GD_COMPLETE_COMMIT - C1 input: GD_COMPLETION_SNAPSHOT's allData (the SNAP part: the GD fields it reads)
const e = [{{node:code_node_CCentry.data}}][0];
const snap = joinChunks([{{node:sql_node_CCc1part.data}}][0], e.partPrefix + "SNAP|");
return { ok: snap && snap.id ? "YES" : "NO", allData: snap || {} };
