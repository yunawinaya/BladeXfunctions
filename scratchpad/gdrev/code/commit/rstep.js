// GD_REVERT_COMMIT - the guarded steps (R0 revalidate, R2 reservations, R4 the delivery): each prepared row ({ id, before,
// after }) against the row read now - at after = done, at before = write, anything else (written by someone else, or gone) =
// a conflict: R0 fails it without writing, R2 / R4 send it to review. The columns are the classic update nodes'.
const RV_COLS = {
  res: ["status", "reserved_qty", "open_qty", "delivered_qty", "doc_type", "doc_id", "doc_no", "doc_line_id", "target_gd_id"],
  frag: ["is_deleted", "status", "open_qty"],
  pend: ["reserved_qty", "open_qty"],
  gdl: ["picking_status"],
  snap: ["snapshot_status"],
  gdh: ["gd_status", "picking_status"],
};
const RV_PART = { res: "RES", frag: "RES", pend: "RES", gdl: "GD", snap: "GD", gdh: "GD" };
const rvParts = function rvParts(entry, partRows) {
  return { RES: joinChunks(partRows, entry.partPrefix + "RES|"), GD: joinChunks(partRows, entry.partPrefix + "GD|") };
};
// a fragment is soft-deleted by its write (is_deleted is one of its columns): a deleted row is gone for the other groups only
const rvGuard = function rvGuard(planned, now, cols) {
  const soft = cols.indexOf("is_deleted") >= 0;
  const writes = [];
  const conflicts = [];
  let atAfter = 0;
  for (const r of planned || []) {
    const cur = (now || {})[s(r.id)];
    if (!cur || (!soft && String(cur.is_deleted) !== "0")) {
      conflicts.push(s(r.id) + " (gone)");
      continue;
    }
    const isBefore = cols.every((c) => sameVal(cur[c], r.before[c]));
    if (cols.every((c) => sameVal(cur[c], r.after[c]))) {
      if (!isBefore) atAfter++;
      continue;
    }
    const row = { id: s(r.id) };
    for (const c of cols) row[c] = r.after[c] === undefined ? null : r.after[c];
    if (isBefore) writes.push(row);
    else conflicts.push(s(r.id));
  }
  return { writes: writes, conflicts: conflicts, atAfter: atAfter };
};
// the ids of the step's groups for its reads ("0" when none; a missing part leaves the plan node to answer)
const rvIds = function rvIds(entry, partRows, groups) {
  const P = rvParts(entry, partRows);
  const out = { ok: groups.every((g) => P[RV_PART[g]]) ? "YES" : "NO" };
  for (const g of Object.keys(RV_COLS)) {
    const part = groups.indexOf(g) >= 0 ? P[RV_PART[g]] || {} : {};
    const ids = Array.from(new Set((Array.isArray(part[g]) ? part[g] : []).map((r) => s(r.id)).filter(digits)));
    out[g + "IdsJson"] = JSON.stringify(ids.length ? ids : ["0"]);
  }
  return out;
};
const rvCounts = (groups, n) => groups.map((g) => n[g] + " " + g).join(", ");
// R0: nothing written yet, so every row must still be at before (a row already at after is left alone); a conflict fails the
// job without writing - unless one of the rows already holds its after-values (a write of this job): then review
const rvRevalidate = function rvRevalidate(entry, partRows, nowRows) {
  if (entry.unlockOk !== "YES") return failNoWrite(entry, "GDR_NOT_LOCKED", "the Goods Delivery is no longer Processing under this job's lock");
  // invoiced meanwhile (an invoice does not wait for Processing): the list's rule
  const si = s(entry.siStatus);
  if (si !== "" && si.toLowerCase() !== "cancelled") return failNoWrite(entry, "GDR_INVOICED", "Already invoiced (" + si + "). Please cancel the sales invoice first.");
  const P = rvParts(entry, partRows);
  if (!P.RES || !P.GD) return failNoWrite(entry, "GDR_INVALID_DATA", "the prepared payload is missing a part");
  const now = byKind(nowRows);
  const conflicts = [];
  const n = {};
  let atAfter = 0;
  for (const g of Object.keys(RV_COLS)) {
    const r = rvGuard(P[RV_PART[g]][g], now[g], RV_COLS[g]);
    for (const id of r.conflicts) conflicts.push(g + " " + id);
    atAfter += r.atAfter;
    n[g] = (P[RV_PART[g]][g] || []).length;
  }
  if (conflicts.length && atAfter) return stepEnd(entry, "R0_REVALIDATE", conflicts.length + " row(s) changed meanwhile (e.g. " + conflicts.slice(0, 3).join(", ") + ") after part of the revert was written", true);
  if (conflicts.length) return failNoWrite(entry, "GDR_STALE", conflicts.length + " row(s) changed since the revert was prepared (e.g. " + conflicts.slice(0, 3).join(", ") + "): nothing was written, revert it again");
  return stepOk(entry, "R0_REVALIDATE", rvCounts(Object.keys(RV_COLS), n), "revalidated");
};
// R2 / R4 plan: per group the rows to write (in slices of 250), the rest done; a conflict -> review
const rvPlan = function rvPlan(entry, partRows, nowRows, groups, step) {
  const P = rvParts(entry, partRows);
  const out = { route: "GO", jobRows: [], needJobUpd: "NO", result_code: "", result_message: "", job_status: "COMMITTING_GD" };
  const now = byKind(nowRows);
  const conflicts = [];
  const n = {};
  for (const g of groups) {
    const part = P[RV_PART[g]];
    if (!part || !Array.isArray(part[g])) return Object.assign(out, stepEnd(entry, step, "the " + RV_PART[g] + " part of the prepared payload is missing", true));
    const r = rvGuard(part[g], now[g], RV_COLS[g]);
    for (const id of r.conflicts) conflicts.push(g + " " + id);
    out[g + "Slices"] = slicesOf(r.writes, 250);
    out[g + "Rows"] = r.writes;
    out["need" + g.charAt(0).toUpperCase() + g.slice(1)] = r.writes.length ? "YES" : "NO";
    n[g] = r.writes.length;
  }
  if (conflicts.length) return Object.assign(out, stepEnd(entry, step, conflicts.length + " row(s) changed by someone else meanwhile (e.g. " + conflicts.slice(0, 3).join(", ") + ")", true));
  out.result_message = step + " writes " + rvCounts(groups, n);
  return out;
};
// R2 / R4 check: every row of the groups reads back at its after-values -> DONE, else a counted retry
const rvCheck = function rvCheck(entry, partRows, backRows, groups, step) {
  const P = rvParts(entry, partRows);
  const now = byKind(backRows);
  const off = [];
  const n = {};
  for (const g of groups) {
    const planned = (P[RV_PART[g]] || {})[g] || [];
    for (const r of offRows(planned, now[g], RV_COLS[g])) off.push(g + " " + s(r.id));
    n[g] = planned.length;
  }
  if (off.length) return stepEnd(entry, step, off.length + " row(s) do not read back (e.g. " + off.slice(0, 3).join(", ") + ")", false);
  return stepOk(entry, step, rvCounts(groups, n), step + " done");
};
