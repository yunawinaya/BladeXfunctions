// GD_CANCEL_COMMIT - X2 input: the ENGINE part (operation key GDX|<job>, the movements)
const e = [{{node:code_node_XCentry.data}}][0];
const eng = joinChunks([{{node:sql_node_XCx2part.data}}][0], e.partPrefix + "ENGINE|");
const ok = eng && s(eng.operation_key) === "GDX|" + e.jobId && Array.isArray(eng.movements) && eng.movements.length > 0;
return { ok: ok ? "YES" : "NO", operationKey: ok ? eng.operation_key : "", movements: ok ? eng.movements : [] };
