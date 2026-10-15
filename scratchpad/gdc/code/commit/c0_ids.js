// GD_COMPLETE_COMMIT - C0 ids: the reservations the RES part updates and the handling units the HU part draws from (for the
// read of their current rows)
const e = [{{node:code_node_CCentry.data}}][0];
const res = joinChunks([{{node:sql_node_CCc0part.data}}][0], e.partPrefix + "RES|");
const hu = joinChunks([{{node:sql_node_CCc0hupart.data}}][0], e.partPrefix + "HU|");
const ids = res && Array.isArray(res.updates) ? res.updates.map((u) => s(u.id)).filter(digits) : [];
const huIds = Array.from(new Set((Array.isArray(hu) ? hu : []).map((u) => s(u.handling_unit_id)).filter(digits)));
console.log("commit C0 ids", JSON.stringify({ part: res ? "ok" : "missing", ids: ids.length, hus: huIds.length }));
return { ok: res ? "YES" : "NO", idsJson: JSON.stringify(ids.length ? ids : ["0"]), count: ids.length, huIdsJson: JSON.stringify(huIds.length ? huIds : ["0"]) };
