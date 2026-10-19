// IA_REVERT_V2_COMMIT - V2 COST lock keys, held as IAV|<job>|C only after V1 DONE (a nested hold blocks the job)
const commitV2LockKeys = function commitV2LockKeys(entry, v2in) {
  const i = v2in || {};
  const plant = s(entry.plantId);
  const keys = s(i.ok) === "YES" && digits(plant) ? list(i.materials).filter((m) => digits(m)).map((m) => "COST|" + s(m) + "|" + plant).sort() : [];
  return { need: keys.length ? "YES" : "NO", keys: keys, keysJson: JSON.stringify(keys), opKey: iaRvCostOwner(entry.jobId) };
};
const res = commitV2LockKeys([{{node:code_node_IVCentry.data}}][0], [{{node:code_node_IVCv2in.data}}][0]);
console.log("commit V2 lock keys", JSON.stringify({ need: res.need, keys: res.keys, op: res.opKey }));
return res;
