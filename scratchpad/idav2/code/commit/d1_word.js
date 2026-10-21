// IDA_V2_COMMIT - D1 decide's exit: a TYPED number taken since PREPARE is worded with code_validate's line label (the LABELS part's
// line of that Batch row: 'Line <i> (<item name>)'); every other outcome passes through unchanged
const commitD1Word = function commitD1Word(entry, d, labelRows) {
  const out = { route: s(d.route), jobRows: list(d.jobRows), needJobUpd: s(d.needJobUpd), unlockRows: list(d.unlockRows), needUnlock: s(d.needUnlock), batchDelSlices: list(d.batchDelSlices),
    needBatchDel: s(d.needBatchDel), result_code: s(d.result_code), result_message: s(d.result_message), job_status: s(d.job_status) };
  if (s(d.needLabels) !== "YES" || s(d.job_status) !== "FAILED") return out;
  const labels = idaJoinChunks(labelRows, entry.partPrefix + "LABELS|");
  const all = labels && typeof labels === "object" ? Object.keys(labels).map((k) => labels[k]).filter((l) => l && typeof l === "object") : [];
  const lab = all.find((l) => s(l.line_id) !== "" && s(l.line_id) === s(d.labelLine)) || null;
  const label = idaLineLabel(lab && s(lab.line_index) ? s(lab.line_index) : "?", { item_name: lab ? s(lab.item_name) : "", item_selection: s(d.labelItem) });
  return Object.assign(out, failNoWrite(entry, "IDA_BATCH_DUPLICATE", IDA_TEXT.typedTaken(label, d.labelNumber), s(d.result_message), []));
};
const res = commitD1Word([{{node:code_node_DCentry.data}}][0], { route: [{{node:code_node_DCd1decide.data.route}}][0], jobRows: [{{node:code_node_DCd1decide.data.jobRows}}][0],
  needJobUpd: [{{node:code_node_DCd1decide.data.needJobUpd}}][0], unlockRows: [{{node:code_node_DCd1decide.data.unlockRows}}][0], needUnlock: [{{node:code_node_DCd1decide.data.needUnlock}}][0],
  batchDelSlices: [{{node:code_node_DCd1decide.data.batchDelSlices}}][0], needBatchDel: [{{node:code_node_DCd1decide.data.needBatchDel}}][0], result_code: [{{node:code_node_DCd1decide.data.result_code}}][0],
  result_message: [{{node:code_node_DCd1decide.data.result_message}}][0], job_status: [{{node:code_node_DCd1decide.data.job_status}}][0], needLabels: [{{node:code_node_DCd1decide.data.needLabels}}][0],
  labelLine: [{{node:code_node_DCd1decide.data.labelLine}}][0], labelItem: [{{node:code_node_DCd1decide.data.labelItem}}][0], labelNumber: [{{node:code_node_DCd1decide.data.labelNumber}}][0] },
  [{{node:sql_node_DCd1dlab.data}}][0]);
console.log("commit D1 exit", JSON.stringify({ route: res.route, job: res.job_status, result: res.result_code }));
return res;
