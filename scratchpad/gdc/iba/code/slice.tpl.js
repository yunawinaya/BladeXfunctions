// INVENTORY_BULK_APPLY slice of __LIST__: rows [index * 250, + 250)
const all = [{{node:__SRC__.data.__LIST__}}][0];
const list = Array.isArray(all) ? all : all ? [all] : [];
const raw = [{{node:__IDX__.data}}][0];
const index = raw === undefined || raw === null || String(raw).trim() === "" ? 0 : parseInt(String(raw).replace(/"/g, ""), 10) || 0;
const rows = list.slice(index * 250, index * 250 + 250);
return { rows: rows, count: String(rows.length), nextIndex: String(index + 1) };
