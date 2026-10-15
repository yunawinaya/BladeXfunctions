const rvPrepRes = rvPrep([{{node:code_node_VPentry.data}}][0], {
  hdr: [{{node:sql_node_VPhdr.data}}][0], lines: [{{node:sql_node_VPlines.data}}][0], movs: [{{node:sql_node_VPmovs.data}}][0], lock: [{{node:sql_node_VPlock.data}}][0],
});
console.log("prepare prep", JSON.stringify({ route: rvPrepRes.route, code: rvPrepRes.code, message: rvPrepRes.message, lines: rvPrepRes.lineCount,
  live: rvList(rvPrepRes.liveRows).length, refuse: rvPrepRes.refuse, unlock: rvPrepRes.unlockOk }));
return rvPrepRes;
