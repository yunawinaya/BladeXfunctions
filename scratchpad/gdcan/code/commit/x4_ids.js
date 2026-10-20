// GD_CANCEL_COMMIT - X4 ids: the GD's Sales Orders and the SO lines its lines point at (for the fresh read)
const e = [{{node:code_node_XCentry.data}}][0];
const so = joinChunks([{{node:sql_node_XCx4part.data}}][0], e.partPrefix + "SO|");
const soIds = so && Array.isArray(so.soIds) ? so.soIds.map(s).filter(digits) : [];
const lineIds = so ? (so.tableGD || []).concat(so.bundleParents || []).map((r) => s(r.so_line_item_id)).filter(digits) : [];
return { ok: so ? "YES" : "NO", soIdsJson: JSON.stringify(soIds.length ? soIds : ["0"]), lineIdsJson: JSON.stringify(lineIds.length ? lineIds : ["0"]) };
