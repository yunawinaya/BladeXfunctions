// SI_SAVE v84 "Map Latest SI": the saved invoice's id, number and total, read back after the write (v83 copied the whole inserted
// row, or re-read the whole invoice on an Edit; only these three are read downstream)
const siLatest = function siLatest(rows) {
  const parseJ = (t) => {
    if (t && typeof t === "object") return t;
    try {
      return JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
    } catch (e) {
      return null;
    }
  };
  const row = (Array.isArray(rows) ? rows : []).map((r) => parseJ(r && r.j !== undefined ? r.j : r)).find((o) => o && o.id) || {};
  const siData = {};
  if (row.id) siData.id = row.id;
  if (row.sales_invoice_no !== undefined && row.sales_invoice_no !== null && row.sales_invoice_no !== "") siData.sales_invoice_no = row.sales_invoice_no;
  if (row.invoice_total !== undefined && row.invoice_total !== null && row.invoice_total !== "") siData.invoice_total = row.invoice_total;
  return { siData };
};
