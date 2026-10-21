// PI_SAVE v20 "Map Latest PI": the saved invoice's id and number, read back after the write (v19 re-read the whole invoice)
const piLatest = function piLatest(rows) {
  const parseJ = (t) => {
    if (t && typeof t === "object") return t;
    try {
      return JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
    } catch (e) {
      return null;
    }
  };
  const row = (Array.isArray(rows) ? rows : []).map((r) => parseJ(r && r.j !== undefined ? r.j : r)).find((o) => o && o.id) || {};
  const piData = {};
  if (row.id) piData.id = row.id;
  if (row.purchase_invoice_no !== undefined && row.purchase_invoice_no !== null && row.purchase_invoice_no !== "") piData.purchase_invoice_no = row.purchase_invoice_no;
  return { piData };
};
