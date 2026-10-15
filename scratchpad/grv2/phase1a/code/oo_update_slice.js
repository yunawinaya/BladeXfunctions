// On-order update slice: the loop's current <= 250 rows (Update On Order)
const slice = [{{node:loop_oo_update}}][0] || {};
const rows = Array.isArray(slice.rows) ? slice.rows : [];
return { rows: rows, count: rows.length };
