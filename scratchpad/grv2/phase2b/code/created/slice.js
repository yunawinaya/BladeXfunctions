// one slice of the write loop: the loop item itself ({ n, rows }), never the whole list again
const it = [{{node:loop_GcPoLines}}][0] || {};
return { n: it.n || 0, rows: Array.isArray(it.rows) ? it.rows : [] };
