// IA_HOLD - Plan: refusals (FIX-03 membership, status, enrolment), the mutex (another live run = BUSY), what an unfinished run
// left (Processing / Releasing rows: their operations are looked up next); CLOSE (after completion) also reads what the completion
// issued from Reserved
const hdPlan = function hdPlan(g, st, member) {
  const stop = (code, why) => ({ route: "STOP", code: code, message: why, needOps: "NO", opsJson: "[]", now: hdS(st && st.now), needConsumed: "NO", noq: "", badNo: "NO" });
  const ia = st && st.ia;
  if (!ia || Number(ia.is_deleted) === 1) return stop("400", "Item Assembly not found.");
  if (hdS(ia.organization_id) !== hdS(g.org)) return stop("400", "This Item Assembly belongs to another organisation.");
  if (!(Number(member) > 0)) return stop("400", "Your user is not assigned to this organisation, so this Item Assembly's materials cannot be reserved.");
  const status = hdS(ia.status);
  if (status === "Processing") return stop("409", "This Item Assembly is being completed in the background: its materials are not changed now.");
  const rows = Array.isArray(st.rows) ? st.rows : [];
  const closing = g.op === "CLOSE";
  if (closing && status !== "Completed" && status !== "Fully Posted") return stop("200", "Nothing to close: the Item Assembly is " + (status || "without a status") + ".");
  if (!closing && status !== "Draft") return stop("200", "Nothing to reserve: the Item Assembly is " + (status || "without a status") + ".");
  if (closing && !rows.length) return stop("200", "Nothing held: there is nothing to close.");
  if (g.op === "RECONCILE" && !hdS(ia.hold) && !rows.length) return stop("200", "Not enrolled: this Item Assembly does not reserve its materials.");
  const now = Date.parse(hdS(st.now).replace(" ", "T") + "Z");
  const live = (Array.isArray(st.held) ? st.held : []).filter((t) => now - Date.parse(hdS(t.started_at).replace(" ", "T") + "Z") < HD_LEASE_MS);
  if (live.length) return stop("409", "Another reservation of this Item Assembly is running: try again in a moment.");
  const ops = hdOpsOf(rows);
  // CLOSE reads by the IA number, which reaches SQL text: only the characters the numbering rules write (else Needs review)
  const safeNo = /^[A-Za-z0-9 ._#()\/-]{1,64}$/.test(hdS(ia.no));
  return { route: "GO", code: "200", message: "", needOps: ops.length ? "YES" : "NO", opsJson: JSON.stringify(ops), now: hdS(st.now),
    needConsumed: closing && safeNo ? "YES" : "NO", noq: closing && safeNo ? hdS(ia.no) : "", badNo: closing && !safeNo ? "YES" : "NO" };
};
const res = hdPlan([{{node:code_node_HDguard.data}}][0] || {}, hdSqlRow([{{node:sql_node_HDstate.data}}][0]), (hdSqlRow([{{node:sql_node_HDmember.data}}][0]) || {}).member);
console.log("hold plan", JSON.stringify({ route: res.route, code: res.code, message: res.message, ops: res.opsJson }));
return res;
