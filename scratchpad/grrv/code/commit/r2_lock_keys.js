// GR_REVERT_COMMIT - R2 COST locks: R2 writes plant-level FIFO / weighted-average rows itself; every engine APPLY takes
// COST|<material>|<plant> for those rows (INVENTORY_BULK_APPLY v8), so R2 takes the same keys, sorted, as GRV|<job>|R2
const commitR2LockKeys = function commitR2LockKeys(entry, r2in) {
  const i = r2in || {};
  const plant = s(entry.plantId);
  const mats = {};
  for (const r of list(i.fifo).concat(list(i.waDelete), list(i.waRestate))) if (digits(r.material_id)) mats[s(r.material_id)] = 1;
  const keys = s(i.ok) === "YES" && digits(plant) ? Object.keys(mats).map((m) => "COST|" + m + "|" + plant).sort() : [];
  return { need: keys.length ? "YES" : "NO", keys: keys, keysJson: JSON.stringify(keys), opKey: "GRV|" + s(entry.jobId) + "|R2" };
};
const res = commitR2LockKeys([{{node:code_node_VCentry.data}}][0], [{{node:code_node_VCr2in.data}}][0]);
console.log("commit R2 lock keys", JSON.stringify({ need: res.need, keys: res.keys.length }));
return res;
