// INVENTORY_BULK_APPLY fence before the first write: this run's generation must still be the latest; a later call that found its
// heartbeat stale took over -> write nothing. If that later run already ENDED with the operation DONE, every key this operation
// still holds was taken by this run after that run gave its keys back -> this run gives them back; else they are the later run's
const s = (v) => (v === undefined || v === null ? "" : String(v));
const rows = [{{node:sql_node_IBfence.data}}][0];
const r = (Array.isArray(rows) ? rows : rows ? [rows] : [])[0] || {};
const mine = s([{{node:code_node_IBstate.data.runGen}}][0]);
const latest = s(r.latest_gen);
const superseded = latest !== mine;
return { route: superseded ? "SUPERSEDED" : "OK", dbNow: s(r.db_now),
  release: superseded && s(r.latest_status) === "ENDED" && Number(r.done) > 0 ? "YES" : "NO",
  message: "superseded by a later call of the same operation (run " + latest + " after this run " + mine + "): nothing written" };
