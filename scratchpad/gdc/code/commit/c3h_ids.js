// GD_COMPLETE_COMMIT - C3H ids: the handling units the HU part draws from (for the fresh read of them and their item rows)
const e = [{{node:code_node_CCentry.data}}][0];
const hu = joinChunks([{{node:sql_node_CCc3hpart.data}}][0], e.partPrefix + "HU|");
const ids = Array.from(new Set((Array.isArray(hu) ? hu : []).map((u) => s(u.handling_unit_id)).filter(digits)));
return { ok: Array.isArray(hu) ? "YES" : "NO", idsJson: JSON.stringify(ids.length ? ids : ["0"]), count: ids.length };
