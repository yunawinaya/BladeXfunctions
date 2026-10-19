// SA_V2_PREPARE - Ids: the id lists of the review reads (code/shared/review_sql.py tokens), from the rows this branch read first.
// REVIEW: lifted code_review_prep over the S|<nonce>|SC record (the request's record, as SUBMIT ran it) -> its materialIds /
// locationIds / baseUomIds / batchIds / orgIdSql (the classic's own lists; saReviewIds) for every review read.
// FORM: the plan's lines (COMPLETE: the S|<nonce>|DOC lines; DIRECT: the stored lines) -> their material ids (items: LABELS
// item codes) and entry location ids (bins: LABELS bin codes); needReview NO: the six review-only reads do not run.
// A part that is missing or unreadable gives "0" lists: the plan fails the job with the reason.
const prepareJoin = function prepareJoin(partRows, names) {
  const want = saList(names).map(saS);
  const rows = saList(partRows).filter((r) => want.indexOf(saS(r.step_name)) >= 0).sort((a, b) => (saS(a.step_name) < saS(b.step_name) ? -1 : 1));
  if (!want.length || rows.length !== want.length) return null;
  return saParseJ(rows.map((r) => (r.result_ref === undefined || r.result_ref === null ? "" : String(r.result_ref))).join(""));
};
const prepareIds = function prepareIds(entry, partRows, lineRows) {
  const none = { MID: "0", LID: "0", BMID: "0", BLID: "0", UID: "0", BID: "0", CMID: "0", ORG: "0", needReview: "NO", why: "" };
  const e = entry || {};
  if (saS(e.route) !== "GO") return Object.assign(none, { why: "entry " + saS(e.route) });
  const req = e.request && typeof e.request === "object" ? e.request : {};
  const parts = req.parts && typeof req.parts === "object" ? req.parts : {};
  const digitsList = (vals) => {
    const out = [];
    for (const v of vals) {
      const t = saS(v);
      if (/^[0-9]{1,20}$/.test(t) && t !== "0" && out.indexOf(t) < 0) out.push(t);
    }
    return out.length ? out.join(",") : "0";
  };
  if (saS(e.action) === "REVIEW") {
    const rec = prepareJoin(partRows, parts.SC);
    if (!rec || typeof rec !== "object" || !Array.isArray(rec.table_stock_count)) return Object.assign(none, { why: "the review's Stock Count part is missing or unreadable" });
    const p = saReviewPrep({ scRecord: rec, createAdjustment: req.createAdjustment, organizationId: saS(req.organizationId) || saS(e.organizationId) });
    const ids = p.ids;
    return Object.assign(none, { MID: ids.MID, LID: ids.LID, BMID: ids.MID, BLID: ids.LID, UID: ids.UID, BID: ids.BID, CMID: ids.MID, ORG: ids.ORG, needReview: "YES" });
  }
  let lines = saRows(lineRows);
  if (saS(e.action) === "COMPLETE") {
    const doc = prepareJoin(partRows, parts.DOC);
    if (!doc || typeof doc !== "object" || !Array.isArray(doc.lines)) return Object.assign(none, { why: "its lines part is missing or unreadable" });
    lines = doc.lines.filter((l) => l && typeof l === "object");
  }
  const mats = [];
  const locs = [];
  for (const l of lines) {
    mats.push(l.material_id);
    for (const b of saJsonList(l.balance_index)) if (b && typeof b === "object") locs.push(b.location_id);
  }
  return Object.assign(none, { MID: digitsList(mats), LID: digitsList(locs) });
};
const res = prepareIds([{{node:code_node_SPentry.data}}][0], [{{node:sql_node_SPparts.data}}][0], [{{node:sql_node_SPlines.data}}][0]);
console.log("prepare ids", JSON.stringify({ MID: res.MID.split(",").length, LID: res.LID.split(",").length, UID: res.UID, BID: res.BID.split(",").length, ORG: res.ORG, why: res.why }));
return { MID: res.MID, LID: res.LID, BMID: res.BMID, BLID: res.BLID, UID: res.UID, BID: res.BID, CMID: res.CMID, ORG: res.ORG, needReview: res.needReview, why: res.why };
