// SI_SAVE v84 "Saved SI": the id this save wrote - the row Add Data inserted (Add / Convert) or the invoice this Edit updated
const siSaved = function siSaved(pageStatus, added, siId) {
  const addedId = Array.isArray(added) ? added[0] : added;
  const raw = pageStatus === "Add" || pageStatus === "Convert" ? addedId : siId;
  const id = raw === undefined || raw === null ? "" : String(raw).trim();
  return { idSql: /^[0-9]{1,20}$/.test(id) ? id : "0" };
};
