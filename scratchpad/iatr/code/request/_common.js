// IA_TRANSFER_REQUEST - shared by its code nodes (after code/shared/iatr_rules.js and iatr_ia.js): a one-row SQL read's JSON column j,
// its 16+ digit numbers kept as text
const trJ = function trJ(rows) {
  const r = (Array.isArray(rows) ? rows : rows ? [rows] : [])[0];
  const j = r && r.j !== undefined ? r.j : null;
  if (j && typeof j === "object") return j;
  try {
    return JSON.parse(String(j || "").replace(/"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))/g, (m, pre, n) => (n === undefined ? m : pre + '"' + n + '"'))) || {};
  } catch (e) {
    return {};
  }
};
