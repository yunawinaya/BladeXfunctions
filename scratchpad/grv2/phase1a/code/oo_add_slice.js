// On-order add slice: the loop's current <= 250 rows (Add On Order)
const slice = [{{node:loop_oo_add}}][0] || {};
const rows = Array.isArray(slice.rows) ? slice.rows : [];
return { rows: rows, count: rows.length };
