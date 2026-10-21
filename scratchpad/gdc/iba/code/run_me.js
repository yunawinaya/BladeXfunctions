// INVENTORY_BULK_APPLY run marker read back: the row id the heartbeats and the end update, and that it carries this run's nonce
const s = (v) => (v === undefined || v === null ? "" : String(v));
const rows = [{{node:sql_node_IBrunMe.data}}][0];
const r = (Array.isArray(rows) ? rows : rows ? [rows] : [])[0] || {};
const own = s(r.result_ref) !== "" && s(r.result_ref) === s([{{node:code_node_IBguard.data.nonce}}][0]) && /^[0-9]{1,20}$/.test(s(r.id));
return { own: own ? "YES" : "NO", runId: own ? s(r.id) : "", dbNow: s(r.db_now) };
