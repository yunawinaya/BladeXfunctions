// IA_HOLD - Mutex: after our ticket is written, the lowest live HELD ticket wins; a loser frees its ticket and answers BUSY
const hdMutex = function hdMutex(mv, tickets, nowText) {
  const now = Date.parse(hdS(nowText).replace(" ", "T") + "Z");
  const live = (tickets || []).filter((t) => now - Date.parse(hdS(t.started_at).replace(" ", "T") + "Z") < HD_LEASE_MS);
  const mine = (tickets || []).find((t) => hdS(t.op) === hdS(mv.opKey));
  const first = live.slice().sort((a, b) => hdNum(a.n) - hdNum(b.n))[0];
  const win = !!mine && !!first && hdS(first.op) === hdS(mv.opKey);
  return { route: win ? "WIN" : "LOSE", ticketId: mine ? hdS(mine.id) : "", freeRows: mine && !win ? [{ id: hdS(mine.id), step_status: "FREE", finished_at: hdS(nowText) }] : [],
    needFree: mine && !win ? "YES" : "NO" };
};
const res = hdMutex([{{node:code_node_HDmoves.data}}][0] || {}, hdSqlRows([{{node:sql_node_HDtickets.data}}][0]), (hdSqlRow([{{node:sql_node_HDstate.data}}][0]) || {}).now);
console.log("hold mutex", JSON.stringify(res));
return res;
