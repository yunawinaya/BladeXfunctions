// IA_TRANSFER_REQUEST - Win (iatrWin2 after our claim is written): ours the lowest live HELD claim of the IA and the decision's facts
// still true -> WIN; else LOSE: our claim freed, 409, nothing written
const trWin = function trWin(g, dec, rows) {
  const st = trJ(rows);
  const w = iatrWin2(g.op, dec.claimName, st, g.lot);
  return { route: w.route, message: w.message, claimId: w.claimId, free: { id: w.claimId || "0", step_status: "FREE", finished_at: iatrS(st.now) || null,
    result_ref: ("LOST|" + g.key).slice(0, 250) }, needFree: w.claimId ? "YES" : "NO" };
};
const res = trWin([{{node:code_node_TRguard.data}}][0], [{{node:code_node_TRdecide.data}}][0], [{{node:sql_node_TRclaims.data}}][0]);
console.log("request win", JSON.stringify({ route: res.route, claim: res.claimId, message: res.message }));
return res;
