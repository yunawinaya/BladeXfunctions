// PI_SAVE v20 "Stored PI Still Draft?": v19's guard, reading the stored invoice's status and number from a sql-node
const piGuard = function piGuard(piId, storedRows) {
  const parseJ = (t) => {
    if (t && typeof t === "object") return t;
    try {
      return JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
    } catch (e) {
      return null;
    }
  };
  const stored = (Array.isArray(storedRows) ? storedRows : []).map((r) => parseJ(r && r.j !== undefined ? r.j : r));
  const record = stored.find((row) => row && String(row.id) === String(piId));
  const storedStatus = record ? String(record.pi_status || "") : "";
  const blocked = storedStatus !== "" && storedStatus !== "Draft";
  return {
    blocked: blocked ? 1 : 0,
    message: blocked
      ? `Purchase Invoice ${record.purchase_invoice_no || ""} is already ${storedStatus}, so it was not saved again. Close and reopen it to see its current state.`
      : "",
  };
};
