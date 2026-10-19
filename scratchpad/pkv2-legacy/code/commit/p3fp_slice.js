// PICKING_BULK_COMMIT - P3 slice (Full Picking): the loop's current slice of <= 250 GD lines
const slice = [{{node:loop_PCp3fpSlices}}][0] || {};
const rows = Array.isArray(slice.rows) ? slice.rows : [];
console.log("commit P3 slice (Full Picking)", JSON.stringify({ count: rows.length }));
return { rows: rows, count: rows.length };
