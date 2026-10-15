// On-order delete slice: the loop's current <= 250 rows (Delete On Order)
const slice = [{{node:loop_oo_delete}}][0] || {};
const rows = Array.isArray(slice.rows) ? slice.rows : [];
return { rows: rows, count: rows.length };
