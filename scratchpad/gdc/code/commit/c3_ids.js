// GD_COMPLETE_COMMIT - C3 ids: the reservations the RES part updates, and its creates' keys
const e = [{{node:code_node_CCentry.data}}][0];
const res = joinChunks([{{node:sql_node_CCc3part.data}}][0], e.partPrefix + "RES|");
const ids = res && Array.isArray(res.updates) ? res.updates.map((u) => s(u.id)).filter(digits) : [];
return { ok: res ? "YES" : "NO", idsJson: JSON.stringify(ids.length ? ids : ["0"]), createLike: e.jobId + "|C|%", updates: ids.length, creates: res && Array.isArray(res.creates) ? res.creates.length : 0 };
