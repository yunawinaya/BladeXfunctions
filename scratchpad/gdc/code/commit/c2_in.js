// GD_COMPLETE_COMMIT - C2 input: the ENGINE part (operation key GDC|<job>, the movements)
const e = [{{node:code_node_CCentry.data}}][0];
const eng = joinChunks([{{node:sql_node_CCc2part.data}}][0], e.partPrefix + "ENGINE|");
const ok = eng && s(eng.operation_key) === "GDC|" + e.jobId && Array.isArray(eng.movements) && eng.movements.length > 0;
return { ok: ok ? "YES" : "NO", operationKey: ok ? eng.operation_key : "", movements: ok ? eng.movements : [] };
