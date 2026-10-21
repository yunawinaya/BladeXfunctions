// PI_SAVE v20 "Saved PI": the id this save wrote - the row Add Data inserted (Add / Convert) or the invoice this Edit updated
const piSaved = function piSaved(pageStatus, added, piId) {
  const addedId = Array.isArray(added) ? added[0] : added;
  const raw = pageStatus === "Add" || pageStatus === "Convert" ? addedId : piId;
  const id = raw === undefined || raw === null ? "" : String(raw).trim();
  return { idSql: /^[0-9]{1,20}$/.test(id) ? id : "0" };
};
