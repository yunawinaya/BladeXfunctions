// LOT_V2_COMMIT - L2 LINES: ONE update of the transfer with update_node_TxDhhT03's props minus the status (the header props +
// the whole stock_movement subform as the form sends it: top-level rows, bundle children nested under `children`, ids kept - never
// sliced: rows missing from the call get soft-deleted).
// COMPLETE / EDIT: SUBMIT's S|..|LINES part, with PREPARE's ALLOC picks merged in by id (V2.1 bundles). Stored lines at the
// request's lineFingerprint (not written yet) or at the target (an earlier attempt) -> write; else REQUIRES_REVIEW.
// DIRECT / STAGE with an ALLOC part (V2.1 bundles): the stored lines, read fresh with every column, rewritten whole with the ALLOC
// picks set by id (a later reconcile / cancel compares the STORED picks), shaped like PO_SAVE's proven tree update (run
// 2110620888312238082): fm_key = id on every row, each child with parent_fm_key = parent_id = its parent's id. The rest must still be at lineFingerprint (ALLOC lines
// read blank there: they had no stock picked), each ALLOC line blank or already at its picks; else REQUIRES_REVIEW.
// Target: ALLOC.fingerprint (PREPARE's, over the merged lines) when there is an ALLOC part, else incomingFingerprint. Done = the
// lines read back at the target, every ALLOC line at its temp_qty_data text and total_quantity (numerically), every child under
// the parent it was written under.
const L2_HEADER = __HEADER__;
const parentOf = (r) => (digits(r && r.parent_id) && s(r.parent_id) !== "0" ? s(r.parent_id) : "");
// rows then their children; bundle parents out (yPlLXIZW's flatLines): a form parent has no parent_fm_key, a stored one no parent_id
const lotFlatRows = function lotFlatRows(rows) {
  const bundleParent = (r) => Boolean(s(r.item_bundle_id) && !s(r.parent_fm_key) && !parentOf(r));
  const out = [];
  for (const r of list(rows)) {
    if (!bundleParent(r)) out.push(r);
    for (const c of list(r.children)) if (!bundleParent(c)) out.push(c);
  }
  return out;
};
const lotTreeRows = (rows) => list(rows).reduce((out, r) => out.concat([r], list(r.children)), []);
// a fingerprint over every row (SUBMIT's incomingFingerprint: lotTreeRows) or over the flat lines (bundle parents out); PREPARE's
// ALLOC.fingerprint may be either view of the merged lines
const fpMatches = (rows, target) => !!s(target) && (lotLineFingerprint(lotTreeRows(rows)) === s(target) || lotLineFingerprint(lotFlatRows(rows)) === s(target));
const fpBoth = (rows) => lotLineFingerprint(lotTreeRows(rows)) + " / " + lotLineFingerprint(lotFlatRows(rows));
const allocDone = (a, cur) => !!cur && s(cur.temp_qty_data) === s(a.temp_qty_data) && sameStored(a.total_quantity, cur.total_quantity);
const blankOf = (rows, ids) => rows.map((r) => (ids[s(r.id)] ? Object.assign({}, r, { temp_qty_data: "" }) : r));
const hasPicks = (v) => s(v) !== "" && s(v) !== "[]";
const commitL2Plan = function commitL2Plan(entry, partRows, allocRows, lineRows, fullRows, hdrRows) {
  const base = { route: "GO", row: {}, needWrite: "NO", lineCount: 0, expect: {}, jobRows: [], needJobUpd: "NO", result_code: "", result_message: "", job_status: "COMMITTING_LOT" };
  const review = (why) => Object.assign(base, stepEnd(entry, "L2_LINES", why, true));
  const stored = lotRows(lineRows);
  const storedById = {};
  for (const r of stored) storedById[s(r.id)] = r;
  let alloc = [];
  let allocFp = "";
  if (entry.hasAlloc === "YES") {
    const a = lotJoinChunks(allocRows, entry.partPrefix + "ALLOC|");
    const ok = a && typeof a === "object" && Array.isArray(a.lines) && a.lines.length > 0
      && a.lines.every((l) => l && digits(l.id) && typeof l.temp_qty_data === "string" && s(l.total_quantity) !== "" && isFinite(Number(l.total_quantity)));
    if (!ok) return review("the ALLOC part of the prepared payload is missing or unreadable");
    alloc = a.lines.map((l) => ({ id: s(l.id), temp_qty_data: l.temp_qty_data, total_quantity: lotQtyStr(l.total_quantity) }));
    if (Object.keys(alloc.reduce((m, l) => Object.assign(m, { [l.id]: 1 }), {})).length !== alloc.length) return review("the ALLOC part names a line twice");
    allocFp = s(a.fingerprint);
  }
  const allocById = {};
  for (const l of alloc) allocById[l.id] = l;
  const withPicks = (r) => (allocById[s(r.id)] ? Object.assign({}, r, { temp_qty_data: allocById[s(r.id)].temp_qty_data, total_quantity: allocById[s(r.id)].total_quantity }) : r);
  const parentsOf = (tree) => {
    const out = {};
    for (const r of list(tree)) {
      if (digits(r.id)) out[s(r.id)] = "";
      for (const c of list(r.children)) if (digits(c.id)) out[s(c.id)] = s(r.id);
    }
    return out;
  };
  let tree;
  let header;
  const expect = { mode: "", lineFingerprint: entry.lineFingerprint, target: "", alloc: alloc, parents: {} };
  if (entry.action === "COMPLETE" || entry.action === "EDIT") {
    const p = lotJoinChunks(partRows, entry.sPartPrefix + "LINES|");
    if (!p || typeof p !== "object" || s(p.lotId) !== entry.lotId || !Array.isArray(p.stock_movement) || !p.header || typeof p.header !== "object") {
      return review("the S LINES part of the request is missing or is not this transfer's");
    }
    if (!entry.incomingFingerprint || s(p.fingerprint) !== entry.incomingFingerprint || !fpMatches(p.stock_movement, entry.incomingFingerprint)) {
      return review("the S LINES part (" + fpBoth(p.stock_movement) + ", stamped " + s(p.fingerprint) + ") is not the request's incomingFingerprint " + (entry.incomingFingerprint || "(none)"));
    }
    const seen = {};
    const fix = (x) => { if (allocById[s(x.id)]) seen[s(x.id)] = 1; return withPicks(x); };
    tree = p.stock_movement.map((r) => (Array.isArray(r.children) ? Object.assign(fix(r), { children: r.children.map(fix) }) : fix(r)));
    const lost = alloc.filter((a) => !seen[a.id]).map((a) => a.id);
    if (lost.length) return review(lost.length + " ALLOC line(s) are not lines of the S LINES part (e.g. " + lost.slice(0, 3).join(", ") + ")");
    header = p.header;
    expect.mode = "INCOMING";
    expect.target = !alloc.length ? entry.incomingFingerprint : allocFp || lotLineFingerprint(lotTreeRows(tree));
    if (alloc.length && allocFp && !fpMatches(tree, allocFp)) return review("the S lines with the ALLOC picks are " + fpBoth(tree) + ", not the ALLOC part's " + allocFp);
    if (lotLineFingerprint(stored) !== entry.lineFingerprint && !fpMatches(stored, expect.target)) {
      return review("the stored lines are " + fpBoth(stored) + ", neither " + entry.lineFingerprint + " (before) nor " + expect.target + " (after)");
    }
  } else if (alloc.length) {
    // DIRECT / STAGE: every stored row goes back with every column, children nested under their parent (the get-node shape)
    const full = lotRows(fullRows).map(withPicks);
    const h = lotRows(hdrRows)[0];
    if (!h || !full.length || full.length !== stored.length) return review("the stored header / lines could not be read whole (" + full.length + " of " + stored.length + " line(s))");
    const lost = alloc.filter((a) => !storedById[a.id]).map((a) => a.id);
    if (lost.length) return review(lost.length + " ALLOC line(s) are not stored lines of this transfer (e.g. " + lost.slice(0, 3).join(", ") + ")");
    const off = alloc.filter((a) => hasPicks(storedById[a.id].temp_qty_data) && !allocDone(a, storedById[a.id])).map((a) => a.id);
    if (off.length) return review(off.length + " ALLOC line(s) hold other picks now (e.g. " + off.slice(0, 3).join(", ") + ")");
    const blank = lotLineFingerprint(blankOf(stored, allocById));
    if (blank !== entry.lineFingerprint) return review("the stored lines changed since the save (" + blank + ", not " + entry.lineFingerprint + ")");
    if (allocFp && !fpMatches(full, allocFp)) return review("the stored lines with the ALLOC picks are " + fpBoth(full) + ", not the ALLOC part's " + allocFp);
    const byId = {};
    for (const r of full) byId[s(r.id)] = r;
    const ord = (a, b) => (Number(a.line_index) || 0) - (Number(b.line_index) || 0) || (s(a.id).length - s(b.id).length) || (s(a.id) < s(b.id) ? -1 : s(a.id) > s(b.id) ? 1 : 0);
    const top = [];
    const orphans = [];
    for (const r of full) {
      r.fm_key = s(r.id);
      const pid = parentOf(r);
      if (!pid) top.push(r);
      else if (byId[pid] && !parentOf(byId[pid])) (byId[pid].children = byId[pid].children || []).push(Object.assign(r, { parent_fm_key: pid, parent_id: pid }));
      else orphans.push(s(r.id));
    }
    if (orphans.length) return review(orphans.length + " stored line(s) name a parent that is not a top-level line of this transfer (e.g. " + orphans.slice(0, 3).join(", ") + ")");
    top.sort(ord);
    for (const r of top) if (r.children) r.children.sort(ord);
    tree = top;
    header = h;
    expect.mode = "STORED";
    expect.target = allocFp;
    expect.parents = parentsOf(tree);
    if (alloc.every((a) => allocDone(a, storedById[a.id])) && (!allocFp || fpMatches(stored, allocFp))) {
      return Object.assign(base, { expect: expect, lineCount: full.length, result_message: "the " + alloc.length + " allocated line(s) are already stored" });
    }
  } else {
    return review("L2 has nothing to write for " + entry.action + " without an ALLOC part");
  }
  expect.parents = parentsOf(tree);
  const row = { id: entry.lotId };
  for (const k of L2_HEADER) row[k] = header[k] === undefined ? null : header[k];
  row.stock_movement = tree;
  return Object.assign(base, { row: row, needWrite: "YES", lineCount: lotTreeRows(tree).length, expect: expect,
    result_message: expect.mode + ": " + lotTreeRows(tree).length + " line(s), " + alloc.length + " allocated" + (expect.target ? " -> " + expect.target : "") });
};
const commitL2Check = function commitL2Check(entry, plan, lineRows) {
  const ex = plan.expect || {};
  const rows = lotRows(lineRows);
  const byId = {};
  for (const r of rows) byId[s(r.id)] = r;
  const allocIds = {};
  for (const a of list(ex.alloc)) allocIds[s(a.id)] = 1;
  if (s(ex.target)) {
    if (!fpMatches(rows, ex.target)) return stepEnd(entry, "L2_LINES", "the lines read back as " + fpBoth(rows) + ", not " + s(ex.target), false);
  } else {
    // DIRECT / STAGE with an ALLOC part that carries no fingerprint: everything but the ALLOC lines still at lineFingerprint
    const blank = lotLineFingerprint(blankOf(rows, allocIds));
    if (ex.mode !== "STORED" || blank !== s(ex.lineFingerprint)) return stepEnd(entry, "L2_LINES", "the lines read back as " + blank + ", not " + (s(ex.lineFingerprint) || "(none)"), false);
  }
  const off = list(ex.alloc).filter((a) => !allocDone(a, byId[s(a.id)])).map((a) => s(a.id));
  if (off.length) return stepEnd(entry, "L2_LINES", off.length + " allocated line(s) do not read back with their picks (e.g. " + off.slice(0, 3).join(", ") + ")", false);
  const moved = Object.keys(ex.parents || {}).filter((id) => !byId[id] || parentOf(byId[id]) !== s(ex.parents[id]));
  if (moved.length) return stepEnd(entry, "L2_LINES", moved.length + " line(s) do not read back under their bundle parent (e.g. " + moved.slice(0, 3).join(", ") + ")", false);
  return stepOk(entry, "L2_LINES", fpBoth(rows) + (ex.alloc && ex.alloc.length ? "; " + ex.alloc.length + " allocated" : ""), "lines saved");
};
const res = __CALL__;
console.log("commit L2", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
