// SA_V2_COMMIT - A1 SA LINES (REVIEW / edited COMPLETE; before the stock moves): ONE update of the Stock Adjustment by id with
// PREPARE's SALINES part - COMPLETE: { id, the DOC header props, stock_adjustment }, REVIEW: { id, stock_adjustment } - never
// adjustment_no / adjustment_no_type / stock_adjustment_status (a number re-issued under the worker's session). Never sliced:
// the whole-subform update keeps the rows sent with an id, inserts the rows without one and soft-deletes every row left out.
// Done-test on the ID-FREE saLineFingerprint (+ the header props): at incomingFingerprint -> done; at lineFingerprint -> write
// (the A1_TRY marker first); at lineFingerprint AFTER a write was tried (this pass's read-back, or a later pass finding A1_TRY:
// the write threw, e.g. the NULL sub_tenant_id cascade on a removed legacy line) -> nothing was written: FAILED + unlock
// SA_LINES_WRITE_FAILED with the platform's error; anything else (a partial write) -> REQUIRES_REVIEW (controller ruling).
// Every row must carry every line column (a key left out is stored NULL).
const SA_HDR = __HEADER__;
const SA_LINE_COLS = __LINECOLS__;
// header props whose stored form cannot be predicted exactly (a timestamp the platform converts, a JSON column MySQL re-spaces):
// the plan compares them loosely (a miss only costs one more identical write), the check after the write not at all
const SA_HDR_LOOSE = ["adjustment_date", "reference_documents"];
const saSortKeys = function saSortKeys(x) {
  if (Array.isArray(x)) return x.map(saSortKeys);
  if (!x || typeof x !== "object") return x;
  const o = {};
  for (const k of Object.keys(x).sort()) o[k] = saSortKeys(x[k]);
  return o;
};
const saCanon = function saCanon(v) {
  if (v === undefined || v === null || v === "") return "";
  const p = typeof v === "string" ? saParseJ(v) : v;
  if (p === null || typeof p !== "object") return s(v);
  const t = JSON.stringify(saSortKeys(p));
  return t === "[]" || t === "{}" ? "" : t;
};
const saDateText = function saDateText(v) {
  const t = s(v);
  const m = t.match(/^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}:\d{2}))?$/);
  return m ? m[1] + " " + (m[2] || "00:00:00") : t;
};
// the lines as stored against the lines written, in line_index order: every fingerprint field exactly (balance_index by its
// hash) except unit_price, a decimal(65,8) the platform rounds to the tenant's rule on write (sameStored)
const saLineExpect = (rows) => saLineFpCanonRows(rows).map((r) => [r[0], r[1], r[2], r[3], r[4], saFpHash(r[5])]);
const saLinesAt = function saLinesAt(lineRows, expect) {
  const got = saLineExpect(saRows(lineRows));
  if (!Array.isArray(expect) || got.length !== expect.length) return false;
  return got.every((g, i) => {
    const w = expect[i] || [];
    return g[0] === w[0] && g[1] === w[1] && g[2] === w[2] && g[3] === w[3] && g[5] === w[5] && (g[4] === w[4] || sameStored(w[4], g[4]));
  });
};
const hdrSame = function hdrSame(k, want, cur, check) {
  if (SA_HDR_LOOSE.indexOf(k) >= 0) {
    if (check) return true;
    return k === "adjustment_date" ? saDateText(want) === saDateText(cur) : saCanon(want) === saCanon(cur);
  }
  return sameStored(want, cur);
};
// the strictly comparable header props (the check's), as stored now: what "the header did not change" is measured against
const hdrSnap = function hdrSnap(header, cur) {
  const o = {};
  for (const k of Object.keys(header)) if (SA_HDR_LOOSE.indexOf(k) < 0) o[k] = cur[k] === undefined ? null : cur[k];
  return o;
};
const writeFailed = function writeFailed(entry, why, errRows) {
  const err = list(errRows)[0] || null;
  const platform = err ? s(err.error_msg).replace(/\s+/g, " ").slice(0, 500) : "";
  const message = MSG.writeFailed + (platform ? " The platform answered: " + platform : "");
  return failNoWrite(entry, "SA_LINES_WRITE_FAILED", message, why + (err ? " (" + s(err.current_node_id) + ": " + platform + ")" : "") + ": no stock was moved");
};
const commitA1Plan = function commitA1Plan(entry, partRows, lineRows, hdrRows, errRows) {
  const complete = entry.action === "COMPLETE";
  const base = { route: "GO", row: {}, header: {}, expect: [], hdrBefore: {}, needFull: "NO", needLines: "NO", lineCount: 0, markerRows: [], needTry: "NO", jobRows: [], needJobUpd: "NO", unlockRows: [],
    needUnlock: "NO", result_code: "", result_message: "", job_status: "COMMITTING_SA" };
  const refuse = (why) => Object.assign(base, failNoWrite(entry, "SA_INVALID_DATA", MSG.invalid, why + ": no stock was moved"));
  const p = saJoinChunks(partRows, entry.partPrefix + "SALINES|");
  if (!p || typeof p !== "object" || !Array.isArray(p.stock_adjustment) || !p.header || typeof p.header !== "object") return refuse("the SALINES part of the prepared payload is missing or unreadable");
  const rows = p.stock_adjustment;
  const target = entry.incomingFingerprint;
  const own = saLineFingerprint(rows);
  if (s(p.fingerprint) !== target || own !== target) return refuse("the SALINES part (" + own + ", stamped " + s(p.fingerprint) + ") is not the plan's incomingFingerprint " + target);
  const off = [];
  rows.forEach((r, i) => {
    const ok = r && typeof r === "object";
    const gone = SA_LINE_COLS.filter((k) => !ok || !(k in r));
    if (gone.length) off.push("row " + (i + 1) + " lacks " + gone.slice(0, 3).join(", "));
    else if (!complete && s(r.id)) off.push("row " + (i + 1) + " carries id " + s(r.id) + " (a review inserts its lines)");
  });
  if (off.length) return refuse(off.length + " SALINES row(s) cannot be written (" + off.slice(0, 3).join("; ") + ")");
  const header = {};
  if (complete) {
    const gone = SA_HDR.filter((k) => !(k in p.header));
    if (gone.length) return refuse("the SALINES header lacks " + gone.join(", "));
    for (const k of SA_HDR) header[k] = p.header[k] === undefined ? null : p.header[k];
  }
  const stored = saRows(lineRows);
  const expect = saLineExpect(rows);
  const fp = saLineFingerprint(stored);
  const linesAt = fp === target || saLinesAt(stored, expect);
  const cur = saRows(hdrRows)[0] || {};
  const hdrAt = Object.keys(header).every((k) => hdrSame(k, header[k], cur[k], false));
  const hdrAtStrict = Object.keys(header).every((k) => hdrSame(k, header[k], cur[k], true));
  const done = (why) => Object.assign(base, { header: header, expect: expect, hdrBefore: hdrSnap(header, cur), result_message: why });
  if (linesAt && hdrAt) return done("the lines" + (complete ? " and the header are" : " are") + " already at " + target);
  if (entry.triedA1 === "YES") {
    // an earlier pass wrote A1_TRY, then the update: it landed (the lines and the verifiable header props at after), stored
    // nothing (the lines still at before: the write threw - e.g. the NULL sub_tenant_id cascade on a removed legacy line - or
    // the run died before it), or it landed half (REQUIRES_REVIEW)
    if (linesAt && hdrAtStrict) return done("written by an earlier pass: the lines at " + target);
    if (fp === entry.lineFingerprint) return Object.assign(base, writeFailed(entry, "an earlier pass tried the A1 write (A1_TRY) and the lines are still at " + fp, errRows));
    return Object.assign(base, stepEnd(entry, "A1_SA_LINES", "after an A1 write the stored lines are " + fp + (linesAt ? " but the header is not as written" : ", neither " + entry.lineFingerprint + " (before) nor " + target + " (after)") + ": a partial write", true));
  }
  // never tried: the lines must be at before
  if (fp !== entry.lineFingerprint) return Object.assign(base, stepEnd(entry, "A1_SA_LINES", "the stored lines are " + fp + ", neither " + entry.lineFingerprint + " (before) nor " + target + " (after)", true));
  // a row sent with an id updates that line: it must be one of this Stock Adjustment's live lines (a COMPLETE keeps its lines' ids)
  const storedIds = {};
  for (const l of stored) storedIds[s(l.id)] = true;
  const foreign = rows.map((r) => s(r.id)).filter((id) => id && !storedIds[id]);
  if (foreign.length) return refuse(foreign.length + " SALINES row id(s) are not lines of this Stock Adjustment (e.g. " + foreign.slice(0, 3).join(", ") + ")");
  const row = Object.assign({ id: entry.saId }, header, { stock_adjustment: rows });
  return Object.assign(base, { row: row, header: header, expect: expect, hdrBefore: hdrSnap(header, cur), needFull: complete ? "YES" : "NO", needLines: complete ? "NO" : "YES",
    lineCount: rows.length, markerRows: [tryRow(entry, "A1_TRY", "pre-write")], needTry: "YES", result_message: (linesAt ? "the header -> " : "the lines " + fp + " -> ") + target });
};
const commitA1Check = function commitA1Check(entry, plan, lineRows, hdrRows) {
  const pl = plan || {};
  const fp = saLineFingerprint(saRows(lineRows));
  const linesAt = fp === entry.incomingFingerprint || saLinesAt(lineRows, pl.expect);
  const want = pl.header && typeof pl.header === "object" ? pl.header : {};
  const cur = saRows(hdrRows)[0] || {};
  const off = Object.keys(want).filter((k) => !hdrSame(k, want[k], cur[k], true));
  if (linesAt && !off.length) return stepOk(entry, "A1_SA_LINES", fp, "lines saved");
  // read back unchanged (the lines at before, the header as the plan read it): the write stored nothing -> a clean failure
  const was = pl.hdrBefore && typeof pl.hdrBefore === "object" ? pl.hdrBefore : {};
  const hdrUnchanged = Object.keys(was).every((k) => sameStored(was[k], cur[k]));
  if (fp === entry.lineFingerprint && hdrUnchanged) return writeFailed(entry, "the A1 write read back unchanged (" + fp + "): the platform accepted it and stored nothing", []);
  return stepEnd(entry, "A1_SA_LINES", "the lines read back as " + fp + (off.length ? " and the header off at " + off.join(", ") : "") + ": neither as before nor as written (a partial write)", true);
};
const res = __CALL__;
console.log("commit A1", JSON.stringify({ route: res.route, write: (res.needFull || "") + "/" + (res.needLines || ""), result: res.result_code, message: res.result_message }));
return res;
