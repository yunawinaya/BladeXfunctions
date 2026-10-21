// GD_REVERT_COMMIT - R1 input: the ENGINE part (operation key GDR|<job>, the movements)
const e = [{{node:code_node_RCentry.data}}][0];
const eng = joinChunks([{{node:sql_node_RCr1part.data}}][0], e.partPrefix + "ENGINE|");
const ok = eng && s(eng.operation_key) === "GDR|" + e.jobId && Array.isArray(eng.movements) && eng.movements.length > 0;
return { ok: ok ? "YES" : "NO", operationKey: ok ? eng.operation_key : "", movements: ok ? eng.movements : [] };
