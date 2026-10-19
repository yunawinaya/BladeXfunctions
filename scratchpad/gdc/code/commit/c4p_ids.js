// GD_COMPLETE_COMMIT - C4P ids: the Picking rows and headers to read by id - an earlier run's intent, else what if_FcApply would
// close now (a re-run after a crash no longer finds the rows it closed in the open-Pickings read)
const e = [{{node:code_node_CCentry.data}}][0];
const intent = joinChunks([{{node:sql_node_CCc4pintent.data}}][0], "C4P|I|");
const plan = intent ? null : fcPlan(list([{{node:sql_node_CCc4ppick.data}}][0]), e.gdId);
const lineIds = (intent ? (intent.lines || []).map((r) => r.id) : plan.lineIds).map(s).filter(digits);
const pickingIds = (intent ? (intent.pickings || []).map((r) => r.id) : plan.pickingIds).map(s).filter(digits);
console.log("commit C4P ids", JSON.stringify({ intent: intent === undefined ? "unreadable" : intent ? "yes" : "no", lines: lineIds.length, pickings: pickingIds.length }));
return { ok: intent === undefined ? "NO" : "YES", lineIdsJson: JSON.stringify(lineIds.length ? lineIds : ["0"]), pickingIdsJson: JSON.stringify(pickingIds.length ? pickingIds : ["0"]) };
