// IA_SAVE - MIN-02: after our claim is written, the lowest live HELD claim of the IA wins; a claim older than the lease is a dead run (a
// classic save, 250 picks at most, cannot run that long). The winner also needs the IA still in the status the guard read (a background
// completion, a cancel or another save may have moved it). A loser frees its own claim and answers 409; nothing is written. Every exit
// after the claim frees the winner's (exitRows). No claim taken (a new IA, a Clone, the switch off): route NONE
const CL_LEASE_MS = 10 * 60 * 1000;
const cin = [{{node:code_node_IAclaimIn.data}}][0] || {};
const mine = [{{node:code_node_IAclaimRow.data}}][0] || {};
const stored = [{{node:code_node_IAguardStored.data.stored}}][0];
const rows = [{{node:sql_node_IAclaims.data}}][0];
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const clWin = function clWin(claimIn, ours, storedStatus, rowsIn) {
  const none = { route: "NONE", claimId: "", message: "", freeRows: [], exitRows: [], needExit: "NO" };
  if (s(claimIn && claimIn.claim) !== "YES") return none;
  let st = {};
  try {
    const r = (Array.isArray(rowsIn) ? rowsIn : rowsIn ? [rowsIn] : [])[0];
    st = (r && r.j !== undefined ? (typeof r.j === "string" ? JSON.parse(r.j) : r.j) : null) || {};
  } catch (e) {
    st = {};
  }
  const now = Date.parse(s(st.now).replace(" ", "T") + "Z");
  const claims = (Array.isArray(st.claims) ? st.claims : []).filter((c) => c && /^CLAIM\|[0-9]+$/.test(s(c.name)));
  const live = claims.filter((c) => now - Date.parse(s(c.started_at).replace(" ", "T") + "Z") < CL_LEASE_MS);
  const me = claims.find((c) => s(c.name) === s(ours && ours.name));
  const first = live.slice().sort((a, b) => Number(s(a.name).slice(6)) - Number(s(b.name).slice(6)))[0];
  const free = me ? [{ id: s(me.id), step_status: "FREE", finished_at: s(st.now) }] : [];
  if (!me || !first || s(first.name) !== s(me.name)) {
    return { route: "LOSE", claimId: me ? s(me.id) : "", message: "This Item Assembly is being completed in another window or by another user: refresh it to see the result.",
      freeRows: free, exitRows: [], needExit: "NO" };
  }
  if (s(storedStatus) !== "" && s(st.status) !== s(storedStatus)) {
    return { route: "LOSE", claimId: s(me.id), message: "This Item Assembly changed while it was being completed (it is " + (s(st.status) || "gone") + " now): refresh it.",
      freeRows: free, exitRows: [], needExit: "NO" };
  }
  return { route: "WIN", claimId: s(me.id), message: "", freeRows: [], exitRows: free, needExit: "YES" };
};
const res = clWin(cin, mine, stored, rows);
console.log("ia claim", JSON.stringify({ route: res.route, claimId: res.claimId }));
return res;
